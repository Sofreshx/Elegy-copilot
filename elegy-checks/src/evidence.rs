use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Default, Debug, Clone)]
pub struct GitEvidence {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub dirty_tree_fingerprint: Option<String>,
}

pub fn git_evidence(repo: &Path) -> GitEvidence {
    let branch = git_value(repo, &["branch", "--show-current"]);
    let head = git_value(repo, &["rev-parse", "HEAD"]);
    let status = git_bytes(repo, &["status", "--porcelain=v1", "--untracked-files=all"]);
    let dirty_tree_fingerprint = status.as_deref().and_then(|status| {
        if status.is_empty() {
            return None;
        }

        let mut hasher = Sha256::new();
        hasher.update(status);
        if let Some(diff) = git_bytes(repo, &["diff", "--no-ext-diff", "--binary", "HEAD", "--"]) {
            hasher.update(diff);
        }
        if let Some(untracked) =
            git_bytes(repo, &["ls-files", "--others", "--exclude-standard", "-z"])
        {
            for relative in untracked
                .split(|byte| *byte == 0)
                .filter(|value| !value.is_empty())
            {
                hasher.update(b"\0untracked\0");
                hasher.update(relative);
                hasher.update(b"\0");
                let relative_path = String::from_utf8_lossy(relative);
                let absolute = repo.join(relative_path.as_ref());
                match fs::symlink_metadata(&absolute) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        hasher.update(b"symlink\0");
                        if let Ok(target) = fs::read_link(&absolute) {
                            hasher.update(target.to_string_lossy().as_bytes());
                        }
                    }
                    Ok(metadata) if metadata.is_file() => {
                        if let Ok(bytes) = fs::read(&absolute) {
                            hasher.update(bytes);
                        } else {
                            hasher.update(b"unreadable\0");
                        }
                    }
                    Ok(metadata) => hasher.update(metadata.mode().to_string().as_bytes()),
                    Err(_) => hasher.update(b"unreadable\0"),
                }
            }
        }
        Some(format!("{:x}", hasher.finalize()))
    });
    GitEvidence {
        branch,
        head,
        dirty_tree_fingerprint,
    }
}

fn git_value(repo: &Path, args: &[&str]) -> Option<String> {
    let bytes = git_bytes(repo, args)?;
    let value = String::from_utf8_lossy(&bytes).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn git_bytes(repo: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout)
}

trait FileTypeMode {
    fn mode(&self) -> u32;
}

impl FileTypeMode for std::fs::Metadata {
    #[cfg(unix)]
    fn mode(&self) -> u32 {
        use std::os::unix::fs::MetadataExt;
        MetadataExt::mode(self)
    }

    #[cfg(windows)]
    fn mode(&self) -> u32 {
        self.file_type().is_dir() as u32
    }
}
