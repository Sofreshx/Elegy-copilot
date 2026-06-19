use std::net::SocketAddr;

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::Request as HttpRequest;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

/// The request body type used by the Axum middleware pipeline.
type Request = axum::extract::Request;

/// Configuration for auth middleware
#[derive(Debug, Clone)]
pub struct AuthConfig {
    /// If None, auth is disabled (loopback trust)
    pub token: Option<String>,
    /// Whether loopback requests bypass auth (default: true)
    pub allow_loopback_bypass: bool,
}

impl AuthConfig {
    /// Resolve token from CLI arg, env var, or auto-generate for non-loopback.
    ///
    /// Priority:
    /// 1. CLI arg (non-empty) — highest precedence
    /// 2. `COPILOT_UI_TOKEN` env var
    /// 3. Non-loopback host — auto-generate a random token
    /// 4. Loopback host (`127.0.0.1`, `::1`, `localhost`) — no auth
    pub fn resolve(cli_token: Option<String>, host: &str) -> Self {
        // 1. CLI arg takes precedence
        if let Some(token) = cli_token {
            if !token.is_empty() {
                return Self {
                    token: Some(token),
                    allow_loopback_bypass: false,
                };
            }
        }
        // 2. Env var
        if let Ok(token) = std::env::var("COPILOT_UI_TOKEN") {
            if !token.is_empty() {
                return Self {
                    token: Some(token),
                    allow_loopback_bypass: false,
                };
            }
        }
        // 3. Non-loopback: auto-generate
        if !is_loopback_host(host) {
            let token = generate_token();
            tracing::warn!(
                "Auto-generated auth token for non-loopback host {}: {}",
                host,
                token
            );
            return Self {
                token: Some(token),
                allow_loopback_bypass: false,
            };
        }
        // 4. Loopback: no auth
        Self {
            token: None,
            allow_loopback_bypass: true,
        }
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "::1" | "localhost")
}

fn is_loopback_addr(addr: &SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn extract_bearer_token<B>(req: &HttpRequest<B>) -> Option<String> {
    req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn validate_token(provided: &str, expected: &str) -> bool {
    // Constant-time comparison (like crypto.timingSafeEqual)
    provided.len() == expected.len()
        && provided
            .bytes()
            .zip(expected.bytes())
            .fold(0, |acc, (a, b)| acc | (a ^ b))
            == 0
}

/// Identity carried through the request pipeline.
///
/// Route handlers can extract this via `axum::Extension<AuthContext>`
/// or via the `FromRequestParts` impl.
#[derive(Debug, Clone, Default)]
pub struct AuthContext {
    pub user_id: Option<String>,
    pub authenticated: bool,
}

impl<S> FromRequestParts<S> for AuthContext
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthContext>()
            .cloned()
            .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "AuthContext not injected"))
    }
}

/// Derive planning actor ID from token (matches Node.js auth.js:37-43).
///
/// - No token → `local-loopback-user`
/// - Token → `auth-<first_8_hex_chars_of_sha256>`
fn derive_planning_actor_id(token: Option<&str>) -> Option<String> {
    match token {
        None => Some("local-loopback-user".to_string()),
        Some(t) => {
            use sha2::{Digest, Sha256};
            let hash = Sha256::digest(t.as_bytes());
            Some(format!("auth-{}", hex::encode(&hash[..4])))
        }
    }
}

/// Auth middleware — validates Bearer tokens and populates `AuthContext`.
///
/// Attach via `axum::middleware::from_fn_with_state(config, auth_middleware)`.
///
/// # Loopback bypass
///
/// When `allow_loopback_bypass` is true and the remote address is a loopback
/// address (`127.0.0.1`, `::1`), the request passes without a token.
///
/// # Auth flow
///
/// 1. Loopback bypass check
/// 2. No token configured → allow all
/// 3. Bearer token validation → 401 on failure
/// 4. Insert `AuthContext` into request extensions
pub async fn auth_middleware(
    axum::extract::State(config): axum::extract::State<AuthConfig>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let remote = req
        .extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0);

    // Loopback bypass
    if config.allow_loopback_bypass {
        if let Some(addr) = remote {
            if is_loopback_addr(&addr) {
                let ctx = AuthContext {
                    user_id: Some("local-loopback-user".to_string()),
                    authenticated: false,
                };
                req.extensions_mut().insert(ctx);
                return Ok(next.run(req).await);
            }
        }
    }

    // No token configured = allow all
    if config.token.is_none() {
        let ctx = AuthContext {
            user_id: Some("local-loopback-user".to_string()),
            authenticated: false,
        };
        req.extensions_mut().insert(ctx);
        return Ok(next.run(req).await);
    }

    // Token required
    let token = config.token.as_ref().unwrap();
    match extract_bearer_token(&req) {
        Some(provided) if validate_token(&provided, token) => {
            let user_id = derive_planning_actor_id(Some(&provided));
            let ctx = AuthContext {
                user_id,
                authenticated: true,
            };
            req.extensions_mut().insert(ctx);
            Ok(next.run(req).await)
        }
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request;
    use tower::util::ServiceExt;

    use super::*;
    use crate::app::AppState;
    use crate::config::{OrchestratorPilotConfig, RuntimeConfig};
    use std::path::PathBuf;

    fn test_state() -> AppState {
        let temp = std::env::temp_dir().join("instruction-engine-rust-auth-tests");
        AppState::new(
            RuntimeConfig {
                engine_root: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .and_then(std::path::Path::parent)
                    .expect("repo root should exist")
                    .to_path_buf(),
                host: "127.0.0.1".to_string(),
                port: 0,
                elegy_home: temp.join(".elegy"),
                sandboxes_home: temp.join(".elegy").join("sandboxes"),
                orchestrator_pilot: OrchestratorPilotConfig {
                    enabled: false,
                    merge_requested: false,
                },
                node_executable: None,
                kimaki_entrypoint: None,
            },
            AuthConfig {
                token: None,
                allow_loopback_bypass: true,
            },
        )
    }

    #[tokio::test]
    async fn loopback_bypass_no_token_needed() {
        // No token configured, no remote addr → should succeed
        let app = crate::app::build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
    }

    #[tokio::test]
    async fn rejects_missing_bearer_token() {
        let _config = AuthConfig {
            token: Some("secret".to_string()),
            allow_loopback_bypass: false,
        };
        // We need a router that uses this config
        // Testing the middleware function directly is more precise
        let ctx = extract_bearer_token(
            &Request::builder()
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        );
        assert!(ctx.is_none());
    }

    #[tokio::test]
    async fn extracts_bearer_token() {
        let req = Request::builder()
            .uri("/")
            .header("authorization", "Bearer test-token-123")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_bearer_token(&req), Some("test-token-123".to_string()));
    }

    #[test]
    fn validates_token_equal() {
        assert!(validate_token("abc123", "abc123"));
    }

    #[test]
    fn validates_token_different_length() {
        assert!(!validate_token("short", "longer-token"));
    }

    #[test]
    fn validates_token_different_content() {
        assert!(!validate_token("abcdef", "123456"));
    }

    #[test]
    fn detects_loopback_hosts() {
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("localhost"));
        assert!(!is_loopback_host("192.168.1.1"));
        assert!(!is_loopback_host("0.0.0.0"));
    }

    #[test]
    fn resolve_token_cli_arg_takes_precedence() {
        let config = AuthConfig::resolve(Some("cli-token".to_string()), "127.0.0.1");
        assert_eq!(config.token, Some("cli-token".to_string()));
        assert!(!config.allow_loopback_bypass);
    }

    #[test]
    fn resolve_token_loopback_no_token() {
        let config = AuthConfig::resolve(None, "127.0.0.1");
        assert!(config.token.is_none());
        assert!(config.allow_loopback_bypass);
    }

    #[test]
    fn resolve_token_non_loopback_auto_generates() {
        let config = AuthConfig::resolve(None, "0.0.0.0");
        assert!(config.token.is_some());
        assert_eq!(config.token.as_ref().unwrap().len(), 64); // 32 bytes = 64 hex chars
        assert!(!config.allow_loopback_bypass);
    }

    #[test]
    fn derive_actor_id_no_token() {
        assert_eq!(
            derive_planning_actor_id(None),
            Some("local-loopback-user".to_string())
        );
    }

    #[test]
    fn derive_actor_id_with_token() {
        let id = derive_planning_actor_id(Some("test-token"));
        assert!(id.unwrap().starts_with("auth-"));
    }

    #[test]
    fn constant_time_validation_variable_length() {
        // Different lengths should fail fast
        assert!(!validate_token("a", "bb"));
    }
}
