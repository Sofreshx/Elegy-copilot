use std::net::SocketAddr;

use anyhow::Context;
use elegy_native_runtime::app::{serve_on, AppState};
use elegy_native_runtime::auth::AuthConfig;
use elegy_native_runtime::config::RuntimeConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("elegy_native_runtime=info,tower_http=info")),
        )
        .with_target(false)
        .compact()
        .init();

    let config = RuntimeConfig::from_env_and_args(None, None, None, None, None);
    let auth = AuthConfig::resolve(None, &config.host);
    let state = AppState::new(config.clone(), auth);

    let address: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .context("invalid bind address")?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .context("failed to bind Rust runtime listener")?;

    let window_url = format!("http://{}:{}", config.host, config.port);
    let payload = serde_json::json!({ "windowUrl": window_url });
    println!("TAURI_RUNTIME_READY {}", payload);

    serve_on(state, listener).await
}
