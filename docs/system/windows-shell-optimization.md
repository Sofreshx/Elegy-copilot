---
created: 2026-06-15
updated: 2026-06-22
category: system
status: current
doc_kind: node
id: windows-shell-optimization
summary: Canonical strategy for Windows shell selection and configuration for AI coding agents. Defines the shell preference order, detection logic, harness configuration, and troubleshooting for WSL, Git Bash, Coreutils pwsh, and PowerShell.
tags: [windows, shell, wsl, git-bash, agent-execution, performance]
related: [system-docs-index, concise-instruction-governance]
---

# Windows Shell Optimization

## Purpose

Define the canonical strategy for selecting, detecting, and configuring the best available shell for AI coding agents (Codex, OpenCode, Copilot) on Windows. Eliminate the PowerShell tax by ranking and preferring POSIX-compatible shells.

## The PowerShell Tax

| Component | Cost | Detail |
|-----------|------|--------|
| Encoding overhead | ~50-200ms/command | UTF-16 ⇄ UTF-8 transcoding on every subprocess call from Node.js/Python agents |
| Startup latency | pwsh: ~300ms, powershell.exe: ~500ms | Compounds across multi-step agent workflows (10 steps → 3-5s lost) |
| Syntax divergence | High failure rate | Agents trained on POSIX bash output generate PowerShell syntax that fails silently or produces wrong results |
| Missing tooling | grep, find, sed, awk absent | Agents emit POSIX commands that fail; no drop-in replacements |
| Pipeline mismatch | Objects vs text streams | `|` chains behave differently; `$env:` vs `$` variable syntax diverges |
| LLM training bias | Most training data is bash | Models produce better bash output than PowerShell output |

## Shell Preference Order

| Rank | Shell | POSIX | Detection | When Used |
|------|-------|-------|-----------|-----------|
| 1 | WSL bash | ✅ | `wsl.exe --status` → `"Default Distribution"` | WSL2 detected with a default distro |
| 2 | Git Bash | ✅ | `where bash.exe`, common paths, registry, `OPENCODE_GIT_BASH_PATH` | Git for Windows installed |
| 3 | Coreutils pwsh | ⚠️ partial | `winget list Microsoft.Coreutils` | Microsoft Coreutils package installed; aliases may conflict |
| 4 | pwsh | ❌ | `where pwsh.exe` | PowerShell 7+ available |
| 5 | powershell | ❌ | `where powershell.exe` | Last resort — Windows ships this by default |

## Detection Logic

The canonical detector is `scripts/shell-detect.mjs`. It probes shells in preference order (best first) and returns the ranked list. Call it programmatically:

### CLI mode

```bash
node scripts/shell-detect.mjs --json
```

Returns the single best shell entry or `null`:

```json
{
  "type": "wsl",
  "path": "wsl.exe",
  "posix": true,
  "available": true
}
```

### List all shells

```bash
node scripts/shell-detect.mjs --all --json
```

Returns the full ranked array:

```json
[
  { "type": "gitbash", "path": "C:\\Program Files\\Git\\bin\\bash.exe", "posix": true, "available": true },
  { "type": "pwsh", "path": "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "posix": false, "available": true }
]
```

### API mode

```js
import { detect, getBestShell } from './scripts/shell-detect.mjs';

const shells = await detect();
// [{ type: 'wsl', path: 'wsl.exe', posix: true, available: true }, ...]

const best = await getBestShell();
// { type: 'wsl', ... }
```

### Probe detail per shell

| Shell | Probe | Fast path | Slow probe |
|-------|-------|-----------|------------|
| WSL | `wsl.exe --status` | Direct check | — |
| Git Bash | `where bash.exe` | `OPENCODE_GIT_BASH_PATH` env var | Registry query |
| Coreutils | `winget list Microsoft.Coreutils` | — | winget (5s) |
| pwsh | `where pwsh.exe` | Direct check | — |
| powershell | `where powershell.exe` | Direct check | — |

Set `skipSlowProbes: true` to skip winget and registry queries when speed matters.

## Harness Configuration

### OpenCode

Set the `"shell"` key in `opencode.jsonc`:

```json
{
  "shell": "/usr/bin/bash"
}
```

Absolute Windows paths are also supported:

```json
{
  "shell": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

### Codex

Set `[windows] shell` in `config.toml`:

```toml
[windows]
shell = "bash"
```

Valid values: `"bash"`, `"pwsh"`, `"powershell"`.

### Worktree plugin

Auto-detects shell on worktree init using `shell-detect.mjs`. No manual config needed unless override is required.

## Copilot Launcher — Terminal Detection Chain

The launcher selects the terminal in this order:

1. WSL bash — if `wsl.exe --status` shows a default distribution
2. Git Bash — if `bash.exe` is on PATH or at known install paths
3. Windows Terminal — if `wt.exe` is available (launches with WSL profile)
4. pwsh — PowerShell 7
5. powershell — Windows PowerShell (last resort)

## Windows Native Tool Resolution (gh, node, npm)

WSL bash (`/init`) does not auto-append `.exe` during PATH lookup. The `binfmt_misc` WSL interop only fires at `exec()` time after the shell has found a matching file. Since bash searches PATH for exact filenames, gh (GitHub CLI, not an npm package) is not found — the file on disk is named `gh.exe`.

**Symptoms:**
- `which gh` returns "not found"
- `gh --version` fails with "command not found"
- `gh.exe --version` works
- Affects all Windows-native CLI tools installed via `.exe` (node, npm, docker, etc.)

**Root cause:** Bash command resolution is exact filename. WSL's `binfmt_misc` PE handler (configured via `WSLInterop` at `/proc/sys/fs/binfmt_misc/WSLInterop`) only activates at `exec()`, which never happens because the shell can't find a file named gh (GitHub CLI, not an npm package).

**Fix: Switch to Git Bash.** Git Bash (MSYS2) natively resolves `.exe` through its PATH handling — `which gh` returns `/c/Program Files/GitHub CLI/gh` and `gh --version` works.

OpenCode config change:
```json
"shell": "C:\\Program Files\\Git\\bin\\bash.exe"
```

Alternative fixes:
- Install tools inside WSL (`sudo apt install gh`)
- Create wrapper scripts in `/usr/local/bin/` that delegate to `.exe` files

## WSL Setup

For complete WSL installation and validation guidance, see:

- `opencode-assets/skills/wsl-shell-setup/SKILL.md` — setup skill with step-by-step instructions
- `scripts/shell-detect.mjs` — detection implementation

Quick commands:

```powershell
# Install WSL (admin required)
wsl --install

# Verify default distro
wsl.exe --status

# List installed distros
wsl.exe --list --verbose

# Set Ubuntu as default
wsl --set-default Ubuntu
```

## Troubleshooting

| Issue | Likely Cause | Resolution |
|-------|-------------|------------|
| `shell-detect.mjs` returns null | Non-Windows or no shell probed | Run `process.platform` check; verify each probe manually |
| WSL detected but slow I/O | Repo on `/mnt/c/` (DrvFs) | Clone into `~/code/` on ext4; run `git clone` inside WSL |
| Git Bash commands fail with `$env:` | OpenCode env injection bug (#31904) | Fall back to Coreutils pwsh; set `"shell": "pwsh"` in config |
| Coreutils aliases break POSIX commands | `ls`, `find`, `grep` overridden by Microsoft Coreutils | Document override aliases in shell profile; prefer WSL/Git Bash |
| `where bash.exe` finds Cygwin bash | Cygwin on PATH before Git | Use `OPENCODE_GIT_BASH_PATH` to pin the correct bash |
| WSL2 not installing (no virtualization) | Hyper-V / VT-x disabled in BIOS | Use Git Bash fallback instead |
| gh (GitHub CLI, not an npm package), `node`, `npm` not found in WSL | WSL bash doesn't resolve `.exe` in PATH | Switch to Git Bash (`"shell": "C:\\Program Files\\Git\\bin\\bash.exe"`), or install tools inside WSL |

## Manual Override

To force a specific shell regardless of detection:

1. Set the harness config (see [Harness Configuration](#harness-configuration) above)
2. Set `OPENCODE_GIT_BASH_PATH` env var to pin a custom Git Bash path
3. Verify with `node scripts/shell-detect.mjs --json`

## Related Docs

- `docs/system/index.md` — system docs entrypoint
- `opencode-assets/skills/wsl-shell-setup/SKILL.md` — WSL setup skill
- `scripts/shell-detect.mjs` — shell detection implementation
- [OpenCode Windows (WSL) docs](https://opencode.dev/docs/windows-wsl) — external reference (when available)
- [Microsoft Coreutils](https://github.com/microsoft/coreutils) — Coreutils on Windows docs
