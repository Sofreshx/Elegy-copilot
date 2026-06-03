#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    ffi::OsString,
    io::{BufRead, BufReader, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
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
struct RuntimeChildState(Mutex<Option<Child>>);

#[derive(Deserialize)]
struct RuntimeReadyPayload {
    #[serde(rename = "windowUrl")]
    window_url: String,
}

#[derive(Serialize)]
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
        eprintln!("[tauri-runtime] debug mode, runtime root: {}", root.display());
        return Ok(root);
    }

    let root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve Tauri resource directory: {error}"))?;
    eprintln!("[tauri-runtime] release mode, resource_dir: {}", root.display());
    Ok(root)
}

fn bundled_node_path(_app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(std::env::var_os("INSTRUCTION_ENGINE_TAURI_DEV_NODE_EXECUTABLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node")));
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

fn to_wide_string(s: &str) -> Vec<u16> {
    OsString::from(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn show_error_dialog(title: &str, message: &str) {
    extern "system" {
        fn MessageBoxW(hWnd: *mut core::ffi::c_void, lpText: *const u16, lpCaption: *const u16, uType: u32) -> i32;
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
                (
                    default_channel.to_string(),
                    Some("update_channel_invalid".to_string()),
                    Some(format!(
                        "Updates are blocked because INSTRUCTION_ENGINE_UPDATE_CHANNEL is invalid for the manual-installer Tauri lane: {}.",
                        value.trim()
                    )),
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
    let message = message_override.unwrap_or_else(|| {
        "Connecting to the desktop updater...".to_string()
    });

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
                        return await syncUpdaterState('/api/desktop-updater');
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

        window.instructionEngineDesktop = Object.freeze({
          platform: 'win32',
          shell: 'tauri',
                    updater: Object.freeze({
                        getState: () => pollUpdaterState(),
                        checkForUpdates: () => syncUpdaterState('/api/desktop-updater/check', { method: 'POST' }),
                        downloadUpdate: () => syncUpdaterState('/api/desktop-updater/download', { method: 'POST', timeoutMs: 15000 }),
                        restartToUpdate: async () => {
                            try {
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
                                    : 'Unable to launch the downloaded installer.';
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
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost") | Some("::1"))
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

fn drain_runtime_output(child: &mut Child, stderr_capture: StderrCapture) -> Result<String, String> {
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
                        let _ = sender.send(Err(format!(
                            "Failed to read runtime host stdout: {error}"
                        )));
                    }
                    break;
                }
            }
        }

        if let Some(sender) = ready_sender.take() {
            let _ = sender.send(Err(
                "Tauri runtime host exited before reporting readiness.".to_string(),
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
                    return Err(format!("Tauri runtime host exited early with status {status}."));
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

fn launch_runtime_host(app: &AppHandle, stderr_capture: StderrCapture) -> Result<String, String> {
    eprintln!("[tauri-runtime] resolving runtime root");
    let root = runtime_root(app)?;
    eprintln!("[tauri-runtime] runtime root: {}", root.display());
    let node_executable = bundled_node_path(app, &root)?;
    eprintln!("[tauri-runtime] node executable: {}", node_executable.display());
    let runtime_host = runtime_host_path(&root)?;
    eprintln!("[tauri-runtime] runtime host: {}", runtime_host.display());
    let copilot_ui_root = root.join("copilot-ui");
    let server_entrypoint = copilot_ui_root.join("server.js");
    let gateway_entrypoint = root
        .join("local-tracker")
        .join("dist")
        .join("messagingGateway")
        .join("index.js");
    let workflow_entrypoint = root
        .join("local-tracker")
        .join("dist")
        .join("messagingGateway")
        .join("workflowSidecar.js");

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
        .env("ELEGY_TAURI_GATEWAY_ENTRYPOINT", gateway_entrypoint)
        .env("ELEGY_TAURI_NODE_EXECUTABLE", bundled_node_path(app, &root)?)
        .env("ELEGY_TAURI_RUNTIME_ROOT", &root)
        .env("ELEGY_TAURI_SERVER_ENTRYPOINT", server_entrypoint)
        .env(
            "ELEGY_TAURI_WORKFLOW_SIDECAR_ENTRYPOINT",
            workflow_entrypoint,
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to launch Tauri runtime host: {error}"))?;

    let ready_payload = drain_runtime_output(&mut child, stderr_capture)?;
    let parsed: RuntimeReadyPayload = serde_json::from_str(&ready_payload)
        .map_err(|error| format!("Invalid readiness payload from Tauri runtime host: {error}"))?;

    app.state::<RuntimeChildState>()
        .0
        .lock()
        .map_err(|_| "Unable to lock runtime child state.".to_string())?
        .replace(child);

    Ok(parsed.window_url)
}

fn shutdown_runtime(app: &AppHandle) {
    let runtime_state = app.state::<RuntimeChildState>();
    let mut runtime_guard = match runtime_state.0.lock() {
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
        .map(|home| PathBuf::from(home).join(".copilot").join("tauri-boot.log"))
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
            let window_url = launch_runtime_host(app.handle(), stderr_capture_for_setup)?;
            create_main_window(app.handle(), &window_url)?;
            Ok(())
        })
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
            let stderr_lines = stderr_capture.lock().map(|lines| lines.clone()).unwrap_or_default();
            let error_message = format!("{error}");
            let diagnostics = format_boot_diagnostics(&stderr_lines, &error_message);
            boot_log!("tauri build failed");
            eprintln!("{diagnostics}");
            show_error_dialog("Elegy Copilot - Startup Failed", &diagnostics);
            std::process::exit(1);
        }
    }
}
