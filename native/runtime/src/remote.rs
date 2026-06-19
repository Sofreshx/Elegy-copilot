use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use serde::Serialize;

use crate::config::RuntimeConfig;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub state: String,
    pub available: bool,
    pub ready: bool,
    pub phase: String,
    pub reason: Option<String>,
    pub message: String,
    pub runtime: String,
    pub install_url: Option<String>,
    pub guild_ids: Vec<String>,
    pub app_id: Option<String>,
    pub data_dir: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug)]
struct RemoteInner {
    state: String,
    reason: Option<String>,
    install_url: Option<String>,
    guild_ids: Vec<String>,
    app_id: Option<String>,
    last_error: Option<String>,
    child: Option<Child>,
}

#[derive(Debug, Clone)]
pub struct RemoteRuntime {
    node_executable: Option<PathBuf>,
    kimaki_entrypoint: Option<PathBuf>,
    data_dir: PathBuf,
    callback_url: String,
    inner: Arc<Mutex<RemoteInner>>,
}

impl RemoteRuntime {
    pub fn new(config: &RuntimeConfig) -> Self {
        Self {
            node_executable: config.node_executable.clone(),
            kimaki_entrypoint: config.kimaki_entrypoint.clone(),
            data_dir: config.elegy_home.join("kimaki"),
            callback_url: format!(
                "http://{}:{}/?remote-onboarding=complete",
                config.host, config.port
            ),
            inner: Arc::new(Mutex::new(RemoteInner {
                state: "idle".to_string(),
                reason: None,
                install_url: None,
                guild_ids: Vec::new(),
                app_id: None,
                last_error: None,
                child: None,
            })),
        }
    }

    pub fn available(&self) -> bool {
        self.node_executable.is_some() && self.kimaki_entrypoint.is_some()
    }

    pub fn start(&self) -> Result<(), String> {
        if !self.available() {
            return Err("Kimaki runtime files are unavailable.".to_string());
        }
        {
            let mut inner = self.inner.lock().map_err(|_| "Remote runtime lock failed")?;
            if inner.child.is_some() {
                return Ok(());
            }
            inner.state = "starting".to_string();
            inner.reason = None;
            inner.last_error = None;
        }

        fs::create_dir_all(&self.data_dir).map_err(|error| error.to_string())?;
        let mut child = Command::new(self.node_executable.as_ref().expect("checked"))
            .arg(self.kimaki_entrypoint.as_ref().expect("checked"))
            .arg("--gateway")
            .arg("--data-dir")
            .arg(&self.data_dir)
            .arg("--gateway-callback-url")
            .arg(&self.callback_url)
            .env("KIMAKI_LOCK_PORT", "31001")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.inner
            .lock()
            .map_err(|_| "Remote runtime lock failed")?
            .child = Some(child);

        if let Some(stdout) = stdout {
            let state = Arc::clone(&self.inner);
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Some(payload) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Ok(event) = serde_json::from_str::<serde_json::Value>(payload.trim()) else {
                        continue;
                    };
                    apply_event(&state, &event);
                }
            });
        }

        if let Some(stderr) = stderr {
            let log_path = self.data_dir.join("kimaki.log");
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    append_log(&log_path, &line);
                }
            });
        }

        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let child = {
            let mut inner = self.inner.lock().map_err(|_| "Remote runtime lock failed")?;
            inner.state = "idle".to_string();
            inner.child.take()
        };
        if let Some(mut child) = child {
            child.kill().map_err(|error| error.to_string())?;
            let _ = child.wait();
        }
        Ok(())
    }

    pub fn restart(&self) -> Result<(), String> {
        self.stop()?;
        self.start()
    }

    pub fn status(&self) -> RemoteStatus {
        if !self.available() {
            return RemoteStatus {
                state: "unavailable".to_string(),
                available: false,
                ready: false,
                phase: "error".to_string(),
                reason: Some("kimaki_entrypoint_missing".to_string()),
                message: "Kimaki runtime files are unavailable.".to_string(),
                runtime: "rust".to_string(),
                install_url: None,
                guild_ids: Vec::new(),
                app_id: None,
                data_dir: None,
                last_error: Some("Kimaki runtime files are unavailable.".to_string()),
            };
        }
        let mut inner = self.inner.lock().expect("Remote runtime lock poisoned");
        let exited = inner
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten())
            .map(|status| status.code());
        if let Some(code) = exited {
            inner.child = None;
            inner.state = "error".to_string();
            inner.reason = Some("kimaki_exited".to_string());
            inner.last_error = Some(format!(
                "Kimaki exited unexpectedly (code={}).",
                code.map(|value| value.to_string()).unwrap_or_else(|| "unknown".to_string())
            ));
        }
        let ready = inner.state == "ready";
        RemoteStatus {
            state: inner.state.clone(),
            available: true,
            ready,
            phase: inner.state.clone(),
            reason: inner.reason.clone(),
            message: if ready {
                "Discord remote sessions are connected.".to_string()
            } else {
                inner.last_error.clone().unwrap_or_else(|| {
                    "Complete the Discord installation to connect remote sessions.".to_string()
                })
            },
            runtime: "rust".to_string(),
            install_url: inner.install_url.clone(),
            guild_ids: inner.guild_ids.clone(),
            app_id: inner.app_id.clone(),
            data_dir: Some(self.data_dir.to_string_lossy().to_string()),
            last_error: inner.last_error.clone(),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn run_cli(&self, args: &[String]) -> Result<String, String> {
        if !self.available() {
            return Err("Kimaki runtime files are unavailable.".to_string());
        }
        let output = Command::new(self.node_executable.as_ref().expect("checked"))
            .arg(self.kimaki_entrypoint.as_ref().expect("checked"))
            .args(args)
            .arg("--data-dir")
            .arg(&self.data_dir)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

fn apply_event(state: &Arc<Mutex<RemoteInner>>, event: &serde_json::Value) {
    let Some(event_type) = event.get("type").and_then(|value| value.as_str()) else {
        return;
    };
    let Ok(mut inner) = state.lock() else {
        return;
    };
    match event_type {
        "install_url" => {
            inner.install_url = event.get("url").and_then(|value| value.as_str()).map(str::to_string);
            inner.state = "awaiting_install".to_string();
        }
        "authorized" => inner.state = "awaiting_auth".to_string(),
        "ready" => {
            inner.state = "ready".to_string();
            inner.reason = None;
            inner.last_error = None;
            inner.app_id = event.get("app_id").and_then(|value| value.as_str()).map(str::to_string);
            inner.guild_ids = event
                .get("guild_ids")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
        }
        "error" => {
            inner.state = "error".to_string();
            inner.reason = Some("kimaki_reported_error".to_string());
            inner.last_error = event.get("message").and_then(|value| value.as_str()).map(str::to_string);
        }
        _ => {}
    }
}

fn append_log(path: &Path, line: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}
