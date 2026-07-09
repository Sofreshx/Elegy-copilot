#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::{ffi::OsString, os::windows::ffi::OsStrExt};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";
const READY_PREFIX: &str = "TAURI_RUNTIME_READY ";
const ERROR_PREFIX: &str = "TAURI_RUNTIME_ERROR ";
const SHUTDOWN_SIGNAL: &str = "shutdown\n";
const RUNTIME_BOOT_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DIAGNOSTIC_LINES: usize = 80;
const MAX_MSGBOX_TEXT_LEN: usize = 4096;

type StderrCapture = Arc<Mutex<Vec<String>>>;

#[derive(Default)]
struct RuntimeChildState {
    inner: Mutex<Option<Child>>,
    cancel: Arc<AtomicBool>,
    pid: Mutex<Option<u32>>,
    window_url: Mutex<Option<String>>,
    stderr_capture: Mutex<Option<StderrCapture>>,
}

const RUNTIME_DIAGNOSTIC_SCHEMA: &str = "elegy.runtime-host.diagnostic/v1";
const RUNTIME_DIAGNOSTIC_POLL_INTERVAL: Duration = Duration::from_millis(500);
const RUNTIME_DIAGNOSTIC_PRUNE_KEEP: usize = 16;

fn runtime_diagnostic_logs_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|home| PathBuf::from(home).join(".elegy").join("logs"))
        .unwrap_or_else(|_| PathBuf::from("logs"))
}

fn runtime_diagnostic_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn runtime_diagnostic_format_timestamp(timestamp_ms: u128) -> String {
    let total_seconds = (timestamp_ms / 1000) as u64;
    let millis = (timestamp_ms % 1000) as u64;
    let seconds_in_day = total_seconds % 86_400;
    let hours = seconds_in_day / 3_600;
    let minutes = (seconds_in_day % 3_600) / 60;
    let seconds = seconds_in_day % 60;
    let day_index = total_seconds / 86_400;
    let mut year: u64 = 1970;
    let mut remaining_days = day_index;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_lengths = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for length in &month_lengths {
        if *length as u64 > remaining_days {
            break;
        }
        remaining_days -= *length as u64;
        month += 1;
    }
    let day = remaining_days + 1;
    format!("{year:04}{month:02}{day:02}-{hours:02}{minutes:02}{seconds:02}-{millis:03}",)
}

fn runtime_diagnostic_filename(event: &str, timestamp_ms: u128) -> PathBuf {
    runtime_diagnostic_logs_dir().join(format!(
        "runtime-host-{event}-{}.json",
        runtime_diagnostic_format_timestamp(timestamp_ms),
    ))
}

fn runtime_diagnostic_iso(timestamp_ms: u128) -> String {
    let seconds = (timestamp_ms / 1000) as i64;
    let nanos = ((timestamp_ms % 1000) * 1_000_000) as u32;
    let dt = time_format(seconds, nanos);
    format!("{dt}Z")
}

fn time_format(seconds: i64, nanos: u32) -> String {
    let total_seconds = if seconds < 0 { 0u64 } else { seconds as u64 };
    let seconds_in_day = total_seconds % 86_400;
    let hours = seconds_in_day / 3_600;
    let minutes = (seconds_in_day % 3_600) / 60;
    let seconds = seconds_in_day % 60;
    let day_index = total_seconds / 86_400;
    let mut year: u64 = 1970;
    let mut remaining_days = day_index;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_lengths = if leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u64;
    for length in &month_lengths {
        if *length as u64 > remaining_days {
            break;
        }
        remaining_days -= *length as u64;
        month += 1;
    }
    let day = remaining_days + 1;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{nanos:09}",)
}

fn runtime_diagnostic_json_field_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn write_runtime_diagnostic(
    event: &str,
    pid: Option<u32>,
    window_url: Option<&str>,
    exit_code: Option<i32>,
    signal: Option<&str>,
    last_stderr: &[String],
    timestamp_ms: u128,
) {
    let logs_dir = runtime_diagnostic_logs_dir();
    if let Err(error) = std::fs::create_dir_all(&logs_dir) {
        eprintln!(
            "[tauri-runtime] failed to create logs dir {}: {error}",
            logs_dir.display()
        );
        return;
    }

    let path = runtime_diagnostic_filename(event, timestamp_ms);
    let mut stderr_json = String::from("[");
    for (index, line) in last_stderr.iter().enumerate() {
        if index > 0 {
            stderr_json.push(',');
        }
        stderr_json.push('"');
        stderr_json.push_str(&runtime_diagnostic_json_field_escape(line));
        stderr_json.push('"');
    }
    stderr_json.push(']');

    let pid_value = pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let exit_code_value = exit_code
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string());
    let window_url_value = match window_url {
        Some(value) => format!("\"{}\"", runtime_diagnostic_json_field_escape(value)),
        None => "null".to_string(),
    };
    let signal_value = match signal {
        Some(value) => format!("\"{}\"", runtime_diagnostic_json_field_escape(value)),
        None => "null".to_string(),
    };

    let json = format!(
        "{{\n  \"schema\": \"{schema}\",\n  \"event\": \"{event}\",\n  \"timestamp\": \"{timestamp}\",\n  \"pid\": {pid},\n  \"windowUrl\": {window_url},\n  \"exitCode\": {exit_code},\n  \"signal\": {signal},\n  \"lastStderr\": {stderr}\n}}\n",
        schema = RUNTIME_DIAGNOSTIC_SCHEMA,
        event = runtime_diagnostic_json_field_escape(event),
        timestamp = runtime_diagnostic_iso(timestamp_ms),
        pid = pid_value,
        window_url = window_url_value,
        exit_code = exit_code_value,
        signal = signal_value,
        stderr = stderr_json,
    );

    if let Err(error) = std::fs::write(&path, json) {
        eprintln!(
            "[tauri-runtime] failed to write diagnostic {}: {error}",
            path.display()
        );
        return;
    }

    eprintln!(
        "[tauri-runtime] wrote {} diagnostic to {}",
        event,
        path.display()
    );

    prune_runtime_diagnostics(&logs_dir);
}

fn prune_runtime_diagnostics(logs_dir: &Path) {
    let entries = match std::fs::read_dir(logs_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => continue,
        };
        if !name.starts_with("runtime-host-") || !name.ends_with(".json") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH);
        files.push((path, modified));
    }
    if files.len() <= RUNTIME_DIAGNOSTIC_PRUNE_KEEP {
        return;
    }
    files.sort_by_key(|(_, modified)| *modified);
    let to_remove = files.len() - RUNTIME_DIAGNOSTIC_PRUNE_KEEP;
    for (path, _) in files.iter().take(to_remove) {
        let _ = std::fs::remove_file(path);
    }
}

#[derive(Deserialize)]
struct RuntimeReadyPayload {
    #[serde(rename = "windowUrl")]
    window_url: String,
}

#[derive(Clone, Serialize)]
struct DesktopUpdaterState {
    supported: bool,
    status: String,
    channel: String,
    #[serde(rename = "currentVersion")]
    current_version: String,
    #[serde(rename = "availableVersion")]
    available_version: Option<String>,
    #[serde(rename = "progressPercent")]
    progress_percent: Option<f64>,
    #[serde(rename = "transferredBytes")]
    transferred_bytes: Option<u64>,
    #[serde(rename = "totalBytes")]
    total_bytes: Option<u64>,
    message: Option<String>,
    reason: Option<String>,
    #[serde(rename = "lastUpdatedAtMs")]
    last_updated_at_ms: u64,
    #[serde(rename = "canCheckForUpdates")]
    can_check_for_updates: bool,
    #[serde(rename = "canDownload")]
    can_download: bool,
    #[serde(rename = "canRestartToUpdate")]
    can_restart_to_update: bool,
}

#[derive(Default)]
struct DesktopUpdaterBridgeState {
    state: Mutex<Option<DesktopUpdaterState>>,
    pending_update: Mutex<Option<Update>>,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must stay nested under copilot-ui")
        .parent()
        .expect("copilot-ui must stay nested under the repository root")
        .to_path_buf()
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let root = repo_root();
        eprintln!(
            "[tauri-runtime] debug mode, runtime root: {}",
            root.display()
        );
        return Ok(root);
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve Tauri resource directory: {error}"))?;
    let mut candidates = vec![resource_dir.clone()];
    if let Some(parent) = resource_dir.parent() {
        candidates.push(parent.to_path_buf());
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.to_path_buf());
        }
    }
    let root = resolve_runtime_root_from_candidates(candidates)?;
    eprintln!(
        "[tauri-runtime] release mode, resource_dir: {}",
        root.display()
    );
    Ok(root)
}

fn runtime_root_required_paths(root: &Path) -> (PathBuf, PathBuf) {
    (
        root.join("runtime-manifests")
            .join("windows-tauri-node-sidecar.json"),
        root.join("node").join("node.exe"),
    )
}

fn runtime_root_is_complete(root: &Path) -> bool {
    let (manifest_path, node_path) = runtime_root_required_paths(root);
    manifest_path.exists() && node_path.exists()
}

fn runtime_root_candidate_variants(candidate: &Path) -> Vec<PathBuf> {
    let mut variants = vec![candidate.to_path_buf(), candidate.join("resources")];
    variants.dedup();
    variants
}

fn resolve_runtime_root_from_candidates(candidates: Vec<PathBuf>) -> Result<PathBuf, String> {
    let mut attempted: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        for root in runtime_root_candidate_variants(&candidate) {
            if attempted.iter().any(|existing| existing == &root) {
                continue;
            }
            if runtime_root_is_complete(&root) {
                return Ok(root);
            }
            attempted.push(root);
        }
    }

    let attempted_details = attempted
        .iter()
        .map(|root| {
            let (manifest_path, node_path) = runtime_root_required_paths(root);
            format!(
                "{} (requires runtime-manifests/windows-tauri-node-sidecar.json at {}, node/node.exe at {})",
                root.display(),
                manifest_path.display(),
                node_path.display()
            )
        })
        .collect::<Vec<_>>()
        .join("; ");

    Err(format!(
        "Unable to resolve packaged Tauri runtime resources. Attempted: {attempted_details}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "elegy-copilot-{label}-{}-{}",
            std::process::id(),
            runtime_diagnostic_timestamp_ms()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn write_runtime_layout(root: &Path) {
        std::fs::create_dir_all(root.join("runtime-manifests")).expect("create manifests");
        std::fs::create_dir_all(root.join("node")).expect("create node");
        std::fs::write(
            root.join("runtime-manifests")
                .join("windows-tauri-node-sidecar.json"),
            "{}",
        )
        .expect("write manifest");
        std::fs::write(root.join("node").join("node.exe"), "").expect("write node");
    }

    #[test]
    fn runtime_root_resolver_accepts_nested_resources_layout() {
        let temp = unique_temp_dir("nested-resource-root");
        let install_root = temp.join("install");
        let resources_root = install_root.join("resources");
        write_runtime_layout(&resources_root);

        let resolved = resolve_runtime_root_from_candidates(vec![install_root.clone()])
            .expect("nested resources root should resolve");

        assert_eq!(resolved, resources_root);
        let _ = std::fs::remove_dir_all(temp);
    }

    #[test]
    fn runtime_root_resolver_reports_attempted_paths() {
        let temp = unique_temp_dir("missing-resource-root");
        let install_root = temp.join("install");
        std::fs::create_dir_all(&install_root).expect("create install root");

        let error = resolve_runtime_root_from_candidates(vec![install_root.clone()])
            .expect_err("missing resources should fail closed");
        let message = error.to_string();

        assert!(message.contains(&install_root.display().to_string()));
        assert!(message.contains(&install_root.join("resources").display().to_string()));
        assert!(message.contains("node/node.exe"));
        assert!(message.contains("runtime-manifests/windows-tauri-node-sidecar.json"));
        let _ = std::fs::remove_dir_all(temp);
    }
}

fn bundled_node_path(_app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(
            std::env::var_os("INSTRUCTION_ENGINE_TAURI_DEV_NODE_EXECUTABLE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("node")),
        );
    }

    let node_path = root.join("node").join("node.exe");
    if node_path.exists() {
        return Ok(node_path);
    }

    Err(format!(
        "Bundled Node sidecar is unavailable at {}",
        node_path.display()
    ))
}

fn runtime_host_path(root: &Path) -> Result<PathBuf, String> {
    let runtime_host = root
        .join("copilot-ui")
        .join("lib")
        .join("desktop-shell")
        .join("tauri")
        .join("runtimeHost.js");
    if runtime_host.exists() {
        return Ok(runtime_host);
    }

    Err(format!(
        "Missing compiled Tauri runtime host: {}. Run `npm run build:tauri-runtime-host` first.",
        runtime_host.display()
    ))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn finalize_desktop_updater_state(mut state: DesktopUpdaterState) -> DesktopUpdaterState {
    state.can_check_for_updates =
        state.supported && state.status != "checking" && state.status != "downloading";
    state.can_download = state.supported && state.status == "available";
    state.can_restart_to_update = false;
    state
}

fn set_desktop_updater_state(
    store: &DesktopUpdaterBridgeState,
    patch: DesktopUpdaterState,
) -> DesktopUpdaterState {
    let next = finalize_desktop_updater_state(patch);
    if let Ok(mut guard) = store.state.lock() {
        guard.replace(next.clone());
    }
    next
}

fn desktop_updater_current_state(
    app: &AppHandle,
    store: &DesktopUpdaterBridgeState,
) -> DesktopUpdaterState {
    if let Ok(guard) = store.state.lock() {
        if let Some(state) = guard.as_ref() {
            return state.clone();
        }
    }
    finalize_desktop_updater_state(build_desktop_updater_state(app))
}

fn create_desktop_updater_error_state(
    app: &AppHandle,
    channel: String,
    message: String,
    reason: &str,
) -> DesktopUpdaterState {
    finalize_desktop_updater_state(DesktopUpdaterState {
        supported: false,
        status: "error".to_string(),
        channel,
        current_version: app.package_info().version.to_string(),
        available_version: None,
        progress_percent: None,
        transferred_bytes: None,
        total_bytes: None,
        message: Some(message),
        reason: Some(reason.to_string()),
        last_updated_at_ms: now_ms(),
        can_check_for_updates: false,
        can_download: false,
        can_restart_to_update: false,
    })
}

fn desktop_update_feed_url(app: &AppHandle, channel: &str) -> Result<String, String> {
    if let Ok(value) = std::env::var("INSTRUCTION_ENGINE_UPDATE_FEED_URL") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(value) = std::env::var("INSTRUCTION_ENGINE_UPDATE_FEED_BASE_URL") {
        let trimmed = value.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            return Ok(format!("{trimmed}/{channel}-latest.json"));
        }
    }

    let _ = app;
    Ok(format!(
        "https://github.com/Sofreshx/Elegy-copilot/releases/download/desktop-updates/{channel}-latest.json"
    ))
}

#[tauri::command]
fn desktop_updater_get_state(
    app: AppHandle,
    store: State<'_, DesktopUpdaterBridgeState>,
) -> DesktopUpdaterState {
    desktop_updater_current_state(&app, &store)
}

#[tauri::command]
async fn desktop_updater_check(
    app: AppHandle,
    store: State<'_, DesktopUpdaterBridgeState>,
) -> Result<DesktopUpdaterState, String> {
    let (channel, reason_override, message_override) = resolve_desktop_update_channel(&app);
    if let Some(reason) = reason_override {
        let state = finalize_desktop_updater_state(DesktopUpdaterState {
            supported: false,
            status: "blocked".to_string(),
            channel,
            current_version: app.package_info().version.to_string(),
            available_version: None,
            progress_percent: None,
            transferred_bytes: None,
            total_bytes: None,
            message: message_override,
            reason: Some(reason),
            last_updated_at_ms: now_ms(),
            can_check_for_updates: false,
            can_download: false,
            can_restart_to_update: false,
        });
        return Ok(set_desktop_updater_state(&store, state));
    }

    let feed_url = desktop_update_feed_url(&app, &channel)?;
    let feed_url = Url::parse(&feed_url)
        .map_err(|error| format!("Invalid desktop updater feed URL {feed_url}: {error}"))?;
    let checking = finalize_desktop_updater_state(DesktopUpdaterState {
        supported: true,
        status: "checking".to_string(),
        channel: channel.clone(),
        current_version: app.package_info().version.to_string(),
        available_version: None,
        progress_percent: None,
        transferred_bytes: None,
        total_bytes: None,
        message: Some("Checking signed Tauri update feed...".to_string()),
        reason: None,
        last_updated_at_ms: now_ms(),
        can_check_for_updates: false,
        can_download: false,
        can_restart_to_update: false,
    });
    set_desktop_updater_state(&store, checking);

    let update_result = app
        .updater_builder()
        .endpoints(vec![feed_url])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await;

    match update_result {
        Ok(Some(update)) => {
            if let Ok(mut pending) = store.pending_update.lock() {
                pending.replace(update.clone());
            }
            let state = DesktopUpdaterState {
                supported: true,
                status: "available".to_string(),
                channel,
                current_version: update.current_version.clone(),
                available_version: Some(update.version.clone()),
                progress_percent: None,
                transferred_bytes: None,
                total_bytes: None,
                message: Some(format!("Signed update {} is available.", update.version)),
                reason: None,
                last_updated_at_ms: now_ms(),
                can_check_for_updates: true,
                can_download: true,
                can_restart_to_update: false,
            };
            Ok(set_desktop_updater_state(&store, state))
        }
        Ok(None) => {
            if let Ok(mut pending) = store.pending_update.lock() {
                pending.take();
            }
            let state = DesktopUpdaterState {
                supported: true,
                status: "up-to-date".to_string(),
                channel,
                current_version: app.package_info().version.to_string(),
                available_version: None,
                progress_percent: None,
                transferred_bytes: None,
                total_bytes: None,
                message: Some("You are on the latest signed desktop version.".to_string()),
                reason: None,
                last_updated_at_ms: now_ms(),
                can_check_for_updates: true,
                can_download: false,
                can_restart_to_update: false,
            };
            Ok(set_desktop_updater_state(&store, state))
        }
        Err(error) => {
            let state = create_desktop_updater_error_state(
                &app,
                channel,
                error.to_string(),
                "tauri_updater_error",
            );
            Ok(set_desktop_updater_state(&store, state))
        }
    }
}

#[tauri::command]
async fn desktop_updater_install(
    app: AppHandle,
    store: State<'_, DesktopUpdaterBridgeState>,
) -> Result<DesktopUpdaterState, String> {
    let update = store
        .pending_update
        .lock()
        .map_err(|_| "Unable to lock pending desktop update.".to_string())?
        .clone();
    let Some(update) = update else {
        return Ok(desktop_updater_current_state(&app, &store));
    };

    let installing = DesktopUpdaterState {
        supported: true,
        status: "downloading".to_string(),
        channel: resolve_desktop_update_channel(&app).0,
        current_version: update.current_version.clone(),
        available_version: Some(update.version.clone()),
        progress_percent: Some(0.0),
        transferred_bytes: Some(0),
        total_bytes: None,
        message: Some(format!("Installing signed update {}...", update.version)),
        reason: None,
        last_updated_at_ms: now_ms(),
        can_check_for_updates: false,
        can_download: false,
        can_restart_to_update: false,
    };
    set_desktop_updater_state(&store, installing);

    let mut transferred_bytes: u64 = 0;
    let install_result = update
        .download_and_install(
            |chunk_length, total_bytes| {
                transferred_bytes = transferred_bytes.saturating_add(chunk_length as u64);
                let progress_percent = total_bytes
                    .filter(|total| *total > 0)
                    .map(|total| (transferred_bytes as f64 / total as f64) * 100.0);
                let state = DesktopUpdaterState {
                    supported: true,
                    status: "downloading".to_string(),
                    channel: resolve_desktop_update_channel(&app).0,
                    current_version: update.current_version.clone(),
                    available_version: Some(update.version.clone()),
                    progress_percent,
                    transferred_bytes: Some(transferred_bytes),
                    total_bytes,
                    message: Some(format!("Installing signed update {}...", update.version)),
                    reason: None,
                    last_updated_at_ms: now_ms(),
                    can_check_for_updates: false,
                    can_download: false,
                    can_restart_to_update: false,
                };
                set_desktop_updater_state(&store, state);
            },
            || {},
        )
        .await;

    match install_result {
        Ok(()) => {
            if let Ok(mut pending) = store.pending_update.lock() {
                pending.take();
            }
            let state = DesktopUpdaterState {
                supported: true,
                status: "downloaded".to_string(),
                channel: resolve_desktop_update_channel(&app).0,
                current_version: update.current_version,
                available_version: Some(update.version),
                progress_percent: Some(100.0),
                transferred_bytes: Some(transferred_bytes),
                total_bytes: Some(transferred_bytes),
                message: Some(
                    "Signed update installed. Restart the app if it is still running.".to_string(),
                ),
                reason: None,
                last_updated_at_ms: now_ms(),
                can_check_for_updates: true,
                can_download: false,
                can_restart_to_update: false,
            };
            Ok(set_desktop_updater_state(&store, state))
        }
        Err(error) => {
            let state = create_desktop_updater_error_state(
                &app,
                resolve_desktop_update_channel(&app).0,
                error.to_string(),
                "tauri_updater_error",
            );
            Ok(set_desktop_updater_state(&store, state))
        }
    }
}

#[cfg(windows)]
fn to_wide_string(s: &str) -> Vec<u16> {
    OsString::from(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
    extern "system" {
        fn MessageBoxW(
            hWnd: *mut core::ffi::c_void,
            lpText: *const u16,
            lpCaption: *const u16,
            uType: u32,
        ) -> i32;
    }

    const MB_ICONERROR: u32 = 0x00000010;
    const MB_OK: u32 = 0x00000000;
    const MB_TOPMOST: u32 = 0x00040000;

    let title_w = to_wide_string(title);
    let message_w = to_wide_string(message);

    unsafe {
        MessageBoxW(
            core::ptr::null_mut(),
            message_w.as_ptr(),
            title_w.as_ptr(),
            MB_ICONERROR | MB_OK | MB_TOPMOST,
        );
    }
}

#[cfg(not(windows))]
fn show_error_dialog(title: &str, message: &str) {
    eprintln!("[{title}] {message}");
}

fn format_boot_diagnostics(stderr_lines: &[String], primary_error: &str) -> String {
    let mut output = String::new();
    output.push_str("Elegy Copilot failed to start.\n\n");
    output.push_str("Error: ");
    output.push_str(primary_error);
    output.push('\n');

    if !stderr_lines.is_empty() {
        output.push_str("\n--- Runtime diagnostics ---\n");
        let start = if stderr_lines.len() > MAX_DIAGNOSTIC_LINES {
            stderr_lines.len() - MAX_DIAGNOSTIC_LINES
        } else {
            0
        };
        for line in &stderr_lines[start..] {
            output.push_str(line);
            output.push('\n');
        }
    }

    if output.len() > MAX_MSGBOX_TEXT_LEN {
        output.truncate(MAX_MSGBOX_TEXT_LEN - 20);
        output.push_str("\n... (truncated)");
    }

    output
}

fn resolve_desktop_update_channel(app: &AppHandle) -> (String, Option<String>, Option<String>) {
    let app_version = app.package_info().version.to_string();
    let default_channel = if app_version.contains('-') {
        "prerelease"
    } else {
        "stable"
    };

    match std::env::var("INSTRUCTION_ENGINE_UPDATE_CHANNEL") {
        Ok(value) => {
            let normalized = value.trim().to_lowercase();
            if normalized.is_empty() {
                (default_channel.to_string(), None, None)
            } else if normalized == "stable" || normalized == "prerelease" {
                (normalized, None, None)
            } else {
                let blocked_msg = "Updates are blocked because INSTRUCTION_ENGINE_UPDATE_CHANNEL is invalid for the signed Tauri updater lane: {}.";
                (
                    default_channel.to_string(),
                    Some("update_channel_invalid".to_string()),
                    Some(blocked_msg.replacen("{}", value.trim(), 1)),
                )
            }
        }
        Err(_) => (default_channel.to_string(), None, None),
    }
}

fn build_desktop_updater_state(app: &AppHandle) -> DesktopUpdaterState {
    let current_version = app.package_info().version.to_string();
    let (channel, reason_override, message_override) = resolve_desktop_update_channel(app);
    let supported = reason_override.is_none();
    let status = if supported { "checking" } else { "blocked" };
    let message =
        message_override.unwrap_or_else(|| "Connecting to the desktop updater...".to_string());

    DesktopUpdaterState {
        supported,
        status: status.to_string(),
        channel,
        current_version,
        available_version: None,
        progress_percent: None,
        transferred_bytes: None,
        total_bytes: None,
        message: Some(message),
        reason: reason_override,
        last_updated_at_ms: now_ms(),
        can_check_for_updates: false,
        can_download: false,
        can_restart_to_update: false,
    }
}

fn build_init_script(app: &AppHandle) -> Result<String, String> {
    let updater_state_json = serde_json::to_string(&build_desktop_updater_state(app))
        .map_err(|error| format!("Unable to serialize Tauri updater bridge state: {error}"))?;

    Ok(
        r#"
      (() => {
        const isLoopbackHttpUrl = (value) => {
          try {
            const url = new URL(String(value), window.location.href);
            return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
          } catch {
            return false;
          }
        };

                let currentUpdaterState = Object.freeze(__ELEGY_TAURI_UPDATER_STATE__);
                const updaterListeners = new Set();
                let updaterPollTimer = null;
                let updaterPollInFlight = false;
                const updaterPollIntervalMs = 15000;
                const snapshotUpdaterState = () => ({ ...currentUpdaterState });
                const setUpdaterState = (nextState) => {
                    if (!nextState || typeof nextState !== 'object') {
                        return snapshotUpdaterState();
                    }

                    currentUpdaterState = Object.freeze({ ...nextState });
                    updaterListeners.forEach((listener) => notifyUpdaterListener(listener));
                    return snapshotUpdaterState();
                };
                const notifyUpdaterListener = (listener) => {
                    try {
                        listener(snapshotUpdaterState());
                    } catch {
                        // ignore listener failures in the bridge layer
                    }
                };
                const buildUpdaterError = (fallbackMessage) => ({
                    ...snapshotUpdaterState(),
                    supported: false,
                    status: 'error',
                    message: fallbackMessage,
                    reason: 'desktop_updater_bridge_error',
                    canCheckForUpdates: false,
                    canDownload: false,
                    canRestartToUpdate: false,
                    lastUpdatedAtMs: Date.now(),
                });
                const readUpdaterPayload = async (response) => {
                    let payload = null;
                    try {
                        payload = await response.json();
                    } catch {
                        payload = null;
                    }

                    if (!response.ok) {
                        const message = payload && typeof payload.error === 'string' && payload.error.trim()
                            ? payload.error.trim()
                            : `Desktop updater request failed with HTTP ${response.status}.`;
                        throw new Error(message);
                    }

                    return payload;
                };
                const callUpdaterApi = async (pathname, init = {}) => {
                    const controller = new AbortController();
                    const timeoutMs = Number.isFinite(init.timeoutMs) ? init.timeoutMs : 8000;
                    const timeout = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const response = await fetch(pathname, {
                            ...init,
                            cache: 'no-store',
                            headers: {
                                Accept: 'application/json',
                                ...(init.method && init.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
                                ...(init.headers || {}),
                            },
                            signal: controller.signal,
                        });
                        return await readUpdaterPayload(response);
                    } finally {
                        clearTimeout(timeout);
                    }
                };
                const tauriInvoke = () => {
                    const tauri = window.__TAURI__;
                    return tauri && tauri.core && typeof tauri.core.invoke === 'function'
                        ? tauri.core.invoke.bind(tauri.core)
                        : null;
                };
                const callUpdaterCommand = async (command) => {
                    const invoke = tauriInvoke();
                    if (!invoke) {
                        return null;
                    }
                    return await invoke(command);
                };
                const syncUpdaterCommand = async (command, fallbackPathname, init = {}) => {
                    try {
                        const commandState = await callUpdaterCommand(command);
                        if (commandState) {
                            return setUpdaterState(commandState);
                        }
                    } catch (error) {
                        const message = error instanceof Error && error.message.trim()
                            ? error.message.trim()
                            : String(error || '').trim() || 'Unable to talk to the Tauri updater.';
                        return setUpdaterState(buildUpdaterError(message));
                    }
                    return syncUpdaterState(fallbackPathname, init);
                };
                const syncUpdaterState = async (pathname, init = {}) => {
                    try {
                        const nextState = await callUpdaterApi(pathname, init);
                        return setUpdaterState(nextState);
                    } catch (error) {
                        const message = error instanceof Error && error.message.trim()
                            ? error.message.trim()
                            : 'Unable to talk to the desktop updater backend.';
                        return setUpdaterState(buildUpdaterError(message));
                    }
                };
                const pollUpdaterState = async () => {
                    if (updaterPollInFlight) {
                        return snapshotUpdaterState();
                    }

                    updaterPollInFlight = true;
                    try {
                        return await syncUpdaterCommand('desktop_updater_get_state', '/api/desktop-updater');
                    } finally {
                        updaterPollInFlight = false;
                    }
                };
                const startUpdaterPolling = () => {
                    if (updaterPollTimer || updaterListeners.size === 0) {
                        return;
                    }

                    void pollUpdaterState();
                    updaterPollTimer = window.setInterval(() => {
                        void pollUpdaterState();
                    }, updaterPollIntervalMs);
                };
                const stopUpdaterPolling = () => {
                    if (!updaterPollTimer) {
                        return;
                    }

                    window.clearInterval(updaterPollTimer);
                    updaterPollTimer = null;
                };

        const tauriWindow = () => {
          const tauri = window.__TAURI__;
          const factory = tauri && tauri.window && typeof tauri.window.getCurrentWindow === 'function'
            ? tauri.window.getCurrentWindow.bind(tauri.window)
            : null;
          return factory ? factory() : null;
        };

        const noop = () => Promise.resolve();
        const noopBool = () => Promise.resolve(false);

        const currentWindow = tauriWindow();
        const tauriWindowControls = currentWindow ? {
          minimize: () => Promise.resolve(currentWindow.minimize()).catch(() => {}),
          toggleMaximize: () => Promise.resolve(currentWindow.toggleMaximize()).catch(() => {}),
          close: () => Promise.resolve(currentWindow.close()).catch(() => {}),
          isMaximized: () => Promise.resolve(currentWindow.isMaximized()).catch(() => false),
          startResizeDragging: (direction) => Promise.resolve(currentWindow.startResizeDragging(direction)).catch(() => {}),
        } : null;

        window.instructionEngineDesktop = Object.freeze({
          platform: 'win32',
          shell: 'tauri',
          windowControls: Object.freeze(tauriWindowControls ?? {
            minimize: noop,
            toggleMaximize: noop,
            close: noop,
            isMaximized: noopBool,
            startResizeDragging: () => noop(),
                    }),
                    updater: Object.freeze({
                        getState: () => pollUpdaterState(),
                        checkForUpdates: () => syncUpdaterCommand('desktop_updater_check', '/api/desktop-updater/check', { method: 'POST' }),
                        downloadUpdate: () => syncUpdaterCommand('desktop_updater_install', '/api/desktop-updater/download', { method: 'POST', timeoutMs: 15000 }),
                        restartToUpdate: async () => {
                            try {
                                const invoke = tauriInvoke();
                                if (invoke) {
                                    await invoke('desktop_updater_install');
                                    return true;
                                }
                                const payload = await callUpdaterApi('/api/desktop-updater/restart', {
                                    method: 'POST',
                                    timeoutMs: 10000,
                                });
                                const accepted = Boolean(payload && payload.ok === true);
                                if (accepted) {
                                    queueMicrotask(() => {
                                        try {
                                            window.close();
                                        } catch {
                                            // best-effort close to release app file handles for installer apply
                                        }
                                    });
                                }
                                return accepted;
                            } catch (error) {
                                const message = error instanceof Error && error.message.trim()
                                    ? error.message.trim()
                                    : 'Unable to install the signed update.';
                                setUpdaterState(buildUpdaterError(message));
                                return false;
                            }
                        },
                        subscribe: (listener) => {
                            if (typeof listener !== 'function') {
                                return () => {};
                            }

                            updaterListeners.add(listener);
                            startUpdaterPolling();
                            queueMicrotask(() => notifyUpdaterListener(listener));
                            return () => {
                                updaterListeners.delete(listener);
                                if (updaterListeners.size === 0) {
                                    stopUpdaterPolling();
                                }
                            };
                        },
                    }),
        });

        const originalOpen = window.open.bind(window);
        window.open = function open(url, target, features) {
          if (typeof url === 'string' && !isLoopbackHttpUrl(url)) {
            window.location.assign(new URL(url, window.location.href).toString());
            return null;
          }

          return originalOpen(url, target, features);
        };

        document.addEventListener('click', (event) => {
          const element = event.target instanceof Element ? event.target.closest('a[href]') : null;
          if (!element) {
            return;
          }

          const href = element.getAttribute('href');
          if (!href || isLoopbackHttpUrl(href)) {
            return;
          }

          event.preventDefault();
          window.location.assign(new URL(href, window.location.href).toString());
        }, true);
      })();
        "#
                .replace("__ELEGY_TAURI_UPDATER_STATE__", &updater_state_json),
        )
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn is_loopback_runtime_url(url: &Url) -> bool {
    url.scheme() == "http"
        && matches!(
            url.host_str(),
            Some("127.0.0.1") | Some("localhost") | Some("::1")
        )
}

fn open_external_url(url: &Url) {
    let _ = open::that_detached(url.as_str());
}

fn create_main_window(app: &AppHandle, window_url: &str) -> Result<(), String> {
    let parsed = Url::parse(window_url)
        .map_err(|error| format!("Invalid runtime window URL {window_url}: {error}"))?;
    let init_script = build_init_script(app)?;

    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::External(parsed.clone()))
        .title("Elegy Copilot")
        .inner_size(1360.0, 900.0)
        .min_inner_size(1100.0, 720.0)
        .initialization_script(&init_script)
        .on_navigation(move |url| {
            if is_loopback_runtime_url(url) {
                return true;
            }

            open_external_url(url);
            false
        })
        .build()
        .map(|_| ())
        .map_err(|error| format!("Unable to create Tauri window: {error}"))
}

fn drain_runtime_output(
    child: &mut Child,
    stderr_capture: StderrCapture,
) -> Result<String, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing runtime host stdout pipe.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing runtime host stderr pipe.".to_string())?;

    let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();

    thread::spawn(move || {
        let mut ready_sender = Some(ready_tx);
        for line_result in BufReader::new(stdout).lines() {
            match line_result {
                Ok(line) => {
                    if let Some(payload) = line.strip_prefix(READY_PREFIX) {
                        if let Some(sender) = ready_sender.take() {
                            let _ = sender.send(Ok(payload.to_string()));
                        }
                        continue;
                    }

                    if let Some(payload) = line.strip_prefix(ERROR_PREFIX) {
                        if let Some(sender) = ready_sender.take() {
                            let _ = sender.send(Err(payload.to_string()));
                        }
                        eprintln!("[tauri-runtime] {line}");
                        continue;
                    }

                    println!("[tauri-runtime] {line}");
                }
                Err(error) => {
                    if let Some(sender) = ready_sender.take() {
                        let _ = sender
                            .send(Err(format!("Failed to read runtime host stdout: {error}")));
                    }
                    break;
                }
            }
        }

        if let Some(sender) = ready_sender.take() {
            let _ = sender.send(Err(
                "Tauri runtime host exited before reporting readiness.".to_string()
            ));
        }
    });

    let stderr_capture_clone = Arc::clone(&stderr_capture);
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[tauri-runtime] {line}");
            if let Ok(mut lines) = stderr_capture_clone.lock() {
                lines.push(line);
            }
        }
    });

    let started_at = Instant::now();
    while started_at.elapsed() < RUNTIME_BOOT_TIMEOUT {
        match ready_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Tauri runtime host exited early with status {status}."
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Tauri runtime host output channel disconnected.".to_string())
            }
        }
    }

    Err(format!(
        "Timed out after {}s waiting for the Tauri runtime host.",
        RUNTIME_BOOT_TIMEOUT.as_secs()
    ))
}

fn spawn_runtime_watchdog(app: AppHandle, cancel: Arc<AtomicBool>) {
    thread::spawn(move || {
        let state = app.state::<RuntimeChildState>();
        let started_at = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return;
            }

            thread::sleep(RUNTIME_DIAGNOSTIC_POLL_INTERVAL);

            // Re-check the cancel flag after sleep: shutdown_runtime sets cancel
            // before killing the child, and the kill can complete during this
            // thread's sleep window. Skipping the double-check would cause a
            // false child_unexpected_exit diagnostic on an intentional shutdown.
            if cancel.load(Ordering::SeqCst) {
                return;
            }

            let exit_status = {
                let mut guard = match state.inner.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(child) = guard.as_mut() else {
                    return;
                };
                child.try_wait().ok().flatten()
            };

            let Some(status) = exit_status else {
                if started_at.elapsed() > Duration::from_secs(60 * 60 * 24) {
                    return;
                }
                continue;
            };

            // Final cancel check: even if the child exited *after* the
            // try_wait above, shutdown may still have been requested
            // concurrently. Do not write a diagnostic for a deliberate stop.
            if cancel.load(Ordering::SeqCst) {
                return;
            }

            let pid_value = state.pid.lock().ok().and_then(|guard| *guard);
            let window_url_value = state.window_url.lock().ok().and_then(|guard| guard.clone());
            let last_stderr = state
                .stderr_capture
                .lock()
                .ok()
                .and_then(|guard| {
                    guard
                        .as_ref()
                        .map(|cap| cap.lock().ok().map(|lines| lines.clone()))
                })
                .flatten()
                .unwrap_or_default();

            let exit_code = status.code();
            #[cfg(unix)]
            let signal_name = {
                use std::os::unix::process::ExitStatusExt;
                status.signal().map(|signal| signal.to_string())
            };
            #[cfg(not(unix))]
            let signal_name: Option<String> = None;

            let last_stderr_tail: Vec<String> = if last_stderr.len() > MAX_DIAGNOSTIC_LINES {
                last_stderr[last_stderr.len() - MAX_DIAGNOSTIC_LINES..].to_vec()
            } else {
                last_stderr.clone()
            };

            write_runtime_diagnostic(
                "child_unexpected_exit",
                pid_value,
                window_url_value.as_deref(),
                exit_code,
                signal_name.as_deref(),
                &last_stderr_tail,
                runtime_diagnostic_timestamp_ms(),
            );

            return;
        }
    });
}

fn launch_runtime_host(app: &AppHandle, stderr_capture: StderrCapture) -> Result<String, String> {
    eprintln!("[tauri-runtime] resolving runtime root");
    let root = runtime_root(app)?;
    eprintln!("[tauri-runtime] runtime root: {}", root.display());
    let node_executable = bundled_node_path(app, &root)?;
    eprintln!(
        "[tauri-runtime] node executable: {}",
        node_executable.display()
    );
    let runtime_host = runtime_host_path(&root)?;
    eprintln!("[tauri-runtime] runtime host: {}", runtime_host.display());
    let stderr_capture_for_watchdog = Arc::clone(&stderr_capture);
    let copilot_ui_root = root.join("copilot-ui");
    let server_entrypoint = copilot_ui_root.join("server.js");
    eprintln!("[tauri-runtime] spawning node runtime host");
    let mut child = Command::new(node_executable)
        .arg(runtime_host)
        .env(
            "ELEGY_TAURI_APP_VERSION",
            app.package_info().version.to_string(),
        )
        .env(
            "ELEGY_TAURI_IS_PACKAGED",
            if cfg!(debug_assertions) { "0" } else { "1" },
        )
        .env(
            "ELEGY_TAURI_NODE_EXECUTABLE",
            bundled_node_path(app, &root)?,
        )
        .env("ELEGY_TAURI_RUNTIME_ROOT", &root)
        .env("ELEGY_TAURI_SERVER_ENTRYPOINT", server_entrypoint)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to launch Tauri runtime host: {error}"))?;

    let ready_payload = drain_runtime_output(&mut child, stderr_capture_for_watchdog.clone())?;
    let parsed: RuntimeReadyPayload = serde_json::from_str(&ready_payload)
        .map_err(|error| format!("Invalid readiness payload from Tauri runtime host: {error}"))?;

    let runtime_state = app.state::<RuntimeChildState>();
    let child_pid = child.id();
    {
        let mut inner_guard = runtime_state
            .inner
            .lock()
            .map_err(|_| "Unable to lock runtime child state.".to_string())?;
        inner_guard.replace(child);
    }
    *runtime_state
        .pid
        .lock()
        .map_err(|_| "Unable to lock runtime pid state.".to_string())? = Some(child_pid);
    *runtime_state
        .window_url
        .lock()
        .map_err(|_| "Unable to lock runtime window url state.".to_string())? =
        Some(parsed.window_url.clone());
    *runtime_state
        .stderr_capture
        .lock()
        .map_err(|_| "Unable to lock runtime stderr capture state.".to_string())? =
        Some(stderr_capture_for_watchdog);

    spawn_runtime_watchdog(app.clone(), runtime_state.cancel.clone());

    Ok(parsed.window_url)
}

fn shutdown_runtime(app: &AppHandle) {
    let runtime_state = app.state::<RuntimeChildState>();
    runtime_state.cancel.store(true, Ordering::SeqCst);
    let mut runtime_guard = match runtime_state.inner.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let Some(child) = runtime_guard.as_mut() else {
        return;
    };

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(SHUTDOWN_SIGNAL.as_bytes());
        let _ = stdin.flush();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    runtime_guard.take();
}

fn main() {
    let boot_log_path = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|home| PathBuf::from(home).join(".elegy").join("tauri-boot.log"))
        .unwrap_or_else(|_| PathBuf::from("tauri-boot.log"));

    let _ = std::fs::create_dir_all(boot_log_path.parent().unwrap_or(Path::new(".")));
    let boot_log_file: Option<std::fs::File> = std::fs::File::create(&boot_log_path).ok();

    macro_rules! boot_log {
        ($msg:expr) => {{
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let line = format!("[{ts}] {}\n", $msg);
            eprint!("{line}");
            if let Some(ref f) = boot_log_file {
                use std::io::Write;
                if let Ok(mut clone) = f.try_clone() {
                    let _ = clone.write_all(line.as_bytes());
                }
            }
        }};
    }

    boot_log!("tauri main() entered");

    std::panic::set_hook(Box::new(|panic_info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");
        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = format!(
            "Elegy Copilot crashed unexpectedly.\n\n\
             Panic: {payload}\n\
             Location: {location}\n\
             Thread: {thread_name}"
        );
        eprintln!("[tauri-runtime] PANIC: {payload} at {location} (thread: {thread_name})");
        show_error_dialog("Elegy Copilot - Crash", &message);
    }));

    boot_log!("panic hook installed");

    let stderr_capture: StderrCapture = Arc::new(Mutex::new(Vec::new()));
    let stderr_capture_for_setup = Arc::clone(&stderr_capture);
    let boot_log_file_for_setup = boot_log_file.as_ref().and_then(|f| f.try_clone().ok());

    boot_log!("building tauri app");
    let build_result = tauri::Builder::default()
        .manage(RuntimeChildState::default())
        .manage(DesktopUpdaterBridgeState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .setup(move |app| {
            if let Some(ref f) = boot_log_file_for_setup {
                use std::io::Write;
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                if let Ok(mut clone) = f.try_clone() {
                    let _ = clone.write_all(format!("[{ts}] setup closure entered\n").as_bytes());
                }
            }
            eprintln!("[tauri-runtime] using Node.js backend");
            let window_url = match launch_runtime_host(app.handle(), stderr_capture_for_setup) {
                Ok(url) => url,
                Err(e) => {
                    eprintln!("[tauri-runtime] FATAL: launch_runtime_host failed: {e}");
                    return Err(e.into());
                }
            };
            if let Err(e) = create_main_window(app.handle(), &window_url) {
                eprintln!("[tauri-runtime] FATAL: create_main_window failed: {e}");
                return Err(e.into());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_updater_get_state,
            desktop_updater_check,
            desktop_updater_install,
        ])
        .build(tauri::generate_context!());

    boot_log!("tauri builder completed");

    match build_result {
        Ok(app) => {
            boot_log!("tauri build succeeded, starting event loop");
            app.run(|app, event| match event {
                RunEvent::ExitRequested { api, .. } => {
                    // Prevent app exit — secondary windows (planning graph) may
                    // still be open. The runtime host keeps running until the
                    // Tauri process is explicitly terminated.
                    api.prevent_exit();
                }
                RunEvent::Exit => shutdown_runtime(app),
                _ => {}
            });
            boot_log!("tauri event loop exited");
        }
        Err(error) => {
            let stderr_lines = stderr_capture
                .lock()
                .map(|lines| lines.clone())
                .unwrap_or_default();
            let error_message = format!("{error}");
            let diagnostics = format_boot_diagnostics(&stderr_lines, &error_message);
            boot_log!("tauri build failed");
            eprintln!("{diagnostics}");
            show_error_dialog("Elegy Copilot - Startup Failed", &diagnostics);
            std::process::exit(1);
        }
    }
}
