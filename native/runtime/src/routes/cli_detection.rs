use std::process::Command;

/// Check if a CLI tool is installed and return its version string.
///
/// Uses `where` on Windows and `which` on other platforms to check
/// for the command, then runs `--version` to retrieve the version.
pub fn check_cli(command: &str) -> (bool, Option<String>) {
    let which = if cfg!(windows) { "where" } else { "which" };
    let exists = Command::new(which)
        .arg(command)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !exists {
        return (false, None);
    }

    let version = Command::new(command)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    (true, version)
}

/// Check whether `npm` is available on the system PATH.
pub fn check_npm() -> bool {
    let which = if cfg!(windows) { "where" } else { "which" };
    Command::new(which)
        .arg("npm")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
