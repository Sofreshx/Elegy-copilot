#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";
const READY_PREFIX: &str = "TAURI_RUNTIME_READY ";
const ERROR_PREFIX: &str = "TAURI_RUNTIME_ERROR ";
const SHUTDOWN_SIGNAL: &str = "shutdown\n";
const RUNTIME_BOOT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Default)]
struct RuntimeChildState(Mutex<Option<Child>>);

#[derive(Deserialize)]
struct RuntimeReadyPayload {
    #[serde(rename = "windowUrl")]
    window_url: String,
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
        return Ok(repo_root());
    }

    app.path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve Tauri resource directory: {error}"))
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

fn build_init_script() -> String {
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

        window.instructionEngineDesktop = Object.freeze({
          platform: 'win32',
          shell: 'tauri',
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
    .to_string()
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

    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::External(parsed.clone()))
        .title("Elegy Copilot")
        .inner_size(1360.0, 900.0)
        .min_inner_size(1100.0, 720.0)
        .initialization_script(&build_init_script())
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

fn drain_runtime_output(child: &mut Child) -> Result<String, String> {
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

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[tauri-runtime] {line}");
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

fn launch_runtime_host(app: &AppHandle) -> Result<String, String> {
    let root = runtime_root(app)?;
    let node_executable = bundled_node_path(app, &root)?;
    let runtime_host = runtime_host_path(&root)?;
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

    let ready_payload = drain_runtime_output(&mut child)?;
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
    tauri::Builder::default()
        .manage(RuntimeChildState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }))
        .setup(|app| {
            let window_url = launch_runtime_host(app.handle())?;
            create_main_window(app.handle(), &window_url)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri shell")
        .run(|app, event| match event {
            RunEvent::Exit => shutdown_runtime(app),
            _ => {}
        });
}
