use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub engine_root: PathBuf,
    pub host: String,
    pub port: u16,
    pub elegy_home: PathBuf,
    pub sandboxes_home: PathBuf,
}

impl RuntimeConfig {
    pub fn from_env_and_args(
        engine_root_override: Option<PathBuf>,
        host_override: Option<String>,
        port_override: Option<u16>,
        elegy_home_override: Option<PathBuf>,
        sandboxes_home_override: Option<PathBuf>,
    ) -> Self {
        let env = std::env::vars().collect::<std::collections::HashMap<_, _>>();
        let home_dir = resolve_home_dir(&env);

        let engine_root = engine_root_override.unwrap_or_else(default_engine_root);
        let elegy_home = elegy_home_override.unwrap_or_else(|| resolve_elegy_home(&env, &home_dir));
        let sandboxes_home =
            sandboxes_home_override.unwrap_or_else(|| resolve_sandboxes_home(&home_dir));

        Self {
            engine_root,
            host: host_override.unwrap_or_else(|| "127.0.0.1".to_string()),
            port: port_override.unwrap_or(3211),
            elegy_home,
            sandboxes_home,
        }
    }
}

fn default_engine_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| {
            tracing::warn!("Could not determine engine root from manifest dir, using current dir");
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        })
}

fn resolve_home_dir(env: &std::collections::HashMap<String, String>) -> PathBuf {
    if let Some(home) = env.get("HOME").filter(|value| !value.trim().is_empty()) {
        return PathBuf::from(home);
    }
    if let Some(profile) = env
        .get("USERPROFILE")
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(profile);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_elegy_home(env: &std::collections::HashMap<String, String>, home_dir: &Path) -> PathBuf {
    if let Some(xdg) = env
        .get("XDG_CONFIG_HOME")
        .filter(|value| !value.trim().is_empty())
    {
        return PathBuf::from(xdg);
    }
    home_dir.join(".elegy")
}

fn resolve_sandboxes_home(home_dir: &Path) -> PathBuf {
    home_dir.join(".elegy").join("sandboxes")
}
