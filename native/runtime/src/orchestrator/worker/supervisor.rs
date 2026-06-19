use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub stdin: Vec<u8>,
    pub timeout: Duration,
    pub max_output_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    Exited,
    Cancelled,
    TimedOut,
    OutputLimit,
}

#[derive(Debug)]
pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub observed_output_bytes: u64,
    pub stop_reason: StopReason,
}

pub fn run_process(
    spec: &ProcessSpec,
    cancellation: &CancellationToken,
) -> Result<ProcessOutput, SupervisorError> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|source| SupervisorError::Spawn {
        program: spec.program.clone(),
        source,
    })?;
    if !spec.stdin.is_empty() {
        use std::io::Write;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&spec.stdin)?;
        }
    }

    let observed = Arc::new(Mutex::new(0u64));
    let output_limited = Arc::new(AtomicBool::new(false));
    let stdout = spawn_reader(
        child.stdout.take().expect("piped stdout"),
        spec.max_output_bytes,
        Arc::clone(&observed),
        Arc::clone(&output_limited),
    );
    let stderr = spawn_reader(
        child.stderr.take().expect("piped stderr"),
        spec.max_output_bytes,
        Arc::clone(&observed),
        Arc::clone(&output_limited),
    );

    let started = Instant::now();
    let stop_reason = loop {
        if child.try_wait()?.is_some() {
            break StopReason::Exited;
        }
        if output_limited.load(Ordering::SeqCst) {
            terminate_process_tree(child.id());
            break StopReason::OutputLimit;
        }
        if cancellation.is_cancelled() {
            terminate_process_tree(child.id());
            break StopReason::Cancelled;
        }
        if started.elapsed() >= spec.timeout {
            terminate_process_tree(child.id());
            break StopReason::TimedOut;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let status = child.wait()?;
    let stdout = stdout
        .join()
        .map_err(|_| SupervisorError::ReaderPanicked)??;
    let stderr = stderr
        .join()
        .map_err(|_| SupervisorError::ReaderPanicked)??;
    let observed_output_bytes = *observed
        .lock()
        .map_err(|_| SupervisorError::CounterPoisoned)?;
    Ok(ProcessOutput {
        status,
        stdout,
        stderr,
        observed_output_bytes,
        stop_reason,
    })
}

fn spawn_reader(
    mut reader: impl Read + Send + 'static,
    maximum: u64,
    observed: Arc<Mutex<u64>>,
    limited: Arc<AtomicBool>,
) -> thread::JoinHandle<Result<Vec<u8>, std::io::Error>> {
    thread::spawn(move || {
        let mut retained = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                return Ok(retained);
            }
            let total = {
                let mut total = observed.lock().expect("output counter");
                *total += read as u64;
                *total
            };
            if retained.len() < maximum as usize {
                let remaining = maximum as usize - retained.len();
                retained.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            if total > maximum {
                limited.store(true, Ordering::SeqCst);
            }
        }
    })
}

#[cfg(windows)]
pub(crate) fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
pub(crate) fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}

#[cfg(not(any(windows, unix)))]
pub(crate) fn configure_process_group(_command: &mut Command) {}

#[cfg(windows)]
pub(crate) fn terminate_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(unix)]
pub(crate) fn terminate_process_tree(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

#[cfg(not(any(windows, unix)))]
pub(crate) fn terminate_process_tree(_pid: u32) {}

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error("failed to spawn {program}: {source}")]
    Spawn {
        program: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("process output reader panicked")]
    ReaderPanicked,
    #[error("process output counter lock poisoned")]
    CounterPoisoned,
}
