use elegy_native_runtime::app::{serve, AppState};
use elegy_native_runtime::config::RuntimeConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    let config = RuntimeConfig::from_env_and_args(None, None, None, None, None, None);
    let state = AppState::new(config);
    serve(state).await
}
