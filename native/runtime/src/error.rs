use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    Internal(anyhow::Error),
    Unauthorized(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, kind, error_msg) = match &self {
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.as_str()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.as_str()),
            ApiError::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal", "Internal server error")
            }
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "unauthorized", msg.as_str()),
        };

        // Log internal errors with full detail
        if let ApiError::Internal(err) = &self {
            tracing::error!(error = %err, "internal server error");
        }

        let body = Json(json!({
            "error": error_msg,
            "kind": kind,
        }));

        (status, body).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err)
    }
}
