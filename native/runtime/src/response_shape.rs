use axum::body::Body;
use axum::http::Response;
use elegy_native_contracts::RouteContractShape;
use serde_json::Value;

pub async fn capture_shape(response: Response<Body>) -> RouteContractShape {
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should read");
    let raw = String::from_utf8_lossy(&body_bytes).to_string();

    let (body_type, body_keys) = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Array(_)) => ("json".to_string(), Some(vec!["[array]".to_string()])),
        Ok(Value::Object(map)) => {
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            ("json".to_string(), Some(keys))
        }
        Ok(_) => ("json".to_string(), None),
        Err(_) if raw.is_empty() => ("empty".to_string(), None),
        Err(_) => ("non-json".to_string(), None),
    };

    RouteContractShape {
        status,
        content_type,
        body_type,
        body_keys,
    }
}
