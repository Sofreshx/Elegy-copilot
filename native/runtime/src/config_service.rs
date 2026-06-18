use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};

/// Copilot config stored at ~/.elegy/config.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CopilotConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_sessions: Option<bool>,
    // Catch-all for unknown fields
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub struct ConfigService {
    config_path: PathBuf,
}

impl ConfigService {
    pub fn new(elegy_home: &Path) -> Self {
        Self { config_path: elegy_home.join("config.json") }
    }

    /// Read config, return empty on missing/invalid
    pub fn read_config(&self) -> CopilotConfig {
        if !self.config_path.exists() {
            return CopilotConfig::default();
        }
        std::fs::read_to_string(&self.config_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Atomic write: temp file + rename
    pub fn write_config(&self, config: &CopilotConfig) -> Result<(), String> {
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        let tmp = self.config_path.with_extension("tmp");
        std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.config_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Merge fields into existing config and write atomically
    pub fn write_config_fields(&self, fields: serde_json::Value) -> Result<(), String> {
        let mut config = self.read_config();
        if let serde_json::Value::Object(map) = fields {
            if let Some(v) = map.get("remoteSessions").and_then(|v| v.as_bool()) {
                config.remote_sessions = Some(v);
            }
            // Preserve other known fields from the merge
            for (k, v) in map {
                if k != "remoteSessions" {
                    config.extra.insert(k, v);
                }
            }
        }
        self.write_config(&config)
    }

    pub fn get_remote_sessions(&self) -> bool {
        self.read_config().remote_sessions.unwrap_or(false)
    }

    pub fn set_remote_sessions(&self, enabled: bool) -> Result<(), String> {
        self.write_config_fields(serde_json::json!({"remoteSessions": enabled}))
    }
}
