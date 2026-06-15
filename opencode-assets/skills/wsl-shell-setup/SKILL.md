---
name: wsl-shell-setup
description: Set up and validate WSL or Git Bash as the optimal shell for AI coding agents (Codex, OpenCode) on Windows. Checks WSL2 availability, guides installation if missing, runs smoke tests.
triggers:
  - wsl
  - shell setup
  - windows shell
  - wsl install
  - git bash
  - shell optimization
  - windows agent shell
---

# Skill: wsl-shell-setup

## Purpose

Set up and validate a POSIX-compatible shell (WSL2 or Git Bash) for AI coding agents on Windows. Eliminates PowerShell encoding overhead, startup latency, and command-gap issues.

**Announce at start:** "I'm using the wsl-shell-setup skill to configure the shell for agent execution."

## The PowerShell Tax

| Issue | Impact | Why It Matters |
|-------|--------|----------------|
| Encoding overhead | UTF-16 ↔ UTF-8 transcoding on every subprocess call | Adds ~50-200ms per command |
| LLM training skew | Most agent training data uses POSIX shells (bash) | PowerShell syntax diverges (cmdlets, `$env:`, `|` semantics) |
| Startup latency | pwsh: ~300ms, powershell.exe: ~500ms per invocation | Compounds across multi-step agent workflows |
| Command gaps | `grep`, `find`, `sed`, `awk` are absent or emulated | Agents generate POSIX commands that fail silently |
| Pipeline semantics | PowerShell objects vs text streams | `|` chains behave differently, breaking expected patterns |

Full analysis: `docs/system/windows-shell-optimization.md`

## Detection

Check WSL2 availability in the current Windows environment:

### Step 1: Verify WSL2

```powershell
# Run from PowerShell — check WSL subsystem status
wsl.exe --status
```

**Expected output includes:** `Default Distribution: <name>`

```powershell
# List installed distributions
wsl.exe --list --verbose
```

**Expected:** At least one distro with state `Running` or `Stopped`.

### Step 2: Check via shell-detect script

```bash
# From the repo root, run the shell detector
node scripts/shell-detect.mjs --json
```

**Expected output:** `{ "type": "wsl", "posix": true, ... }` as first entry.

The detection script probes in this ranked order:

| Rank | Shell | Probe | POSIX |
|------|-------|-------|-------|
| 1 | WSL bash | `wsl.exe --status` → "Default Distribution" | ✅ |
| 2 | Git Bash | `where bash.exe`, common paths, registry, env var | ✅ |
| 3 | Coreutils pwsh | `winget list Microsoft.Coreutils` | ⚠️ |
| 4 | pwsh | `where pwsh.exe` | ❌ |
| 5 | powershell | `where powershell.exe` | ❌ |

## Installation Guidance

### WSL not present

If `wsl.exe --status` fails, install WSL:

```powershell
# Requires admin privileges
wsl --install
```

This installs Ubuntu by default. For a lighter distro:

```powershell
wsl --install -d Debian
```

**Post-install steps:**

1. Terminal opens automatically — create a UNIX username and password.
2. Update packages and install dev tools:

```bash
sudo apt update && sudo apt install -y git curl build-essential
```

3. Clone repos into WSL filesystem (`~/code/`) for optimal I/O performance.

### Verify installation

```bash
# Should show Ubuntu/Debian version
cat /etc/os-release | head -3

# Git should be available
git --version

# Node.js for Copilot agents
node --version
npm --version
```

## Validation Smoke Tests

Run these commands inside the target shell to verify it works as an agent execution environment:

### Basic shell operations

```bash
echo "shell test passed"
```

### File operations (POSIX tools)

```bash
ls -la
find . -name "*.md" -maxdepth 1
grep -r "skill" --include="*.md" .
```

### Git operations

```bash
git --version
git status
```

### Node.js (required for Copilot)

```bash
node --version
npm --version
```

All commands should succeed with expected output. If any fail, the shell is not fully operational.

## Harness Validation

### Codex

Run `codex` from within WSL — it should detect bash automatically and use it as the default shell. No config change needed.

### OpenCode

Run `opencode` from within WSL. Verify `opencode.jsonc` has the `"shell"` key pointing to bash:

```json
{
  "shell": "/usr/bin/bash"
}
```

### Shell detection script

```bash
node scripts/shell-detect.mjs --json
```

**Expected:** Returns `wsl` as the first (highest-ranked) entry.

## Fallback — Git Bash

If WSL is unavailable (no virtualization, corporate policy, Hyper-V disabled):

### Install

1. Download Git for Windows from [git-scm.com](https://git-scm.com/)
2. During install, select "Git Bash" component
3. Ensure "Use Git from the command line and also from 3rd-party software" is selected

### Configure

Set the env var for OpenCode detection:

```powershell
[System.Environment]::SetEnvironmentVariable("OPENCODE_GIT_BASH_PATH", "C:\Program Files\Git\bin\bash.exe", "User")
```

### Run smoke tests (same as WSL)

Run the validation smoke tests above inside Git Bash. All should pass.

### Known issue: OpenCode #31904

Git Bash has a known env injection bug on some OpenCode versions. Commands may fail with `$env:` errors. If this occurs, set OpenCode to use `pwsh` as fallback (see Manual Override).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `wsl.exe` not found after install | PATH not updated | Restart terminal / log out and back in |
| `wsl.exe` runs but no default distro | WSL installed but no distro set | `wsl --set-default Ubuntu` |
| Slow I/O on `/mnt/c/` | Cross-filesystem performance penalty | Clone repos into `~/code/` on WSL ext4 |
| Git Bash: `$env:` errors | OpenCode env injection bug (#31904) | Use Coreutils pwsh as fallback |
| Coreutils: `ls`, `find` aliases conflict | Microsoft Coreutils overrides system commands | Document and override aliases in `$PROFILE` |
| `shell-detect.mjs` returns empty | Non-Windows platform or no shells found | Verify Windows, check probes individually |

## Manual Override

Force a specific shell for agent execution:

### OpenCode

Edit `opencode.jsonc`:

```json
{
  "shell": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

Or for Git Bash specifically:

```json
{
  "shell": "C:\\Program Files\\Git\\usr\\bin\\bash.exe"
}
```

### Codex

Edit `config.toml`:

```toml
[windows]
shell = "bash"
```

Or to force PowerShell 7:

```toml
[windows]
shell = "pwsh"
```

## Canonical References

- `docs/system/windows-shell-optimization.md` — full shell optimization strategy
- `scripts/shell-detect.mjs` — detection implementation and ranking
- `opencode-assets/skills/worktree/SKILL.md` — worktree isolation for shell changes
