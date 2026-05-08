$ErrorActionPreference = 'Stop'

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$copilotInstaller = Join-Path $engineRoot 'scripts\cli-install.ps1'
$codexInstaller = Join-Path $engineRoot 'scripts\codex-install.ps1'
$antigravityInstaller = Join-Path $engineRoot 'scripts\antigravity-install.ps1'
$opencodeInstaller = Join-Path $engineRoot 'scripts\opencode-install.ps1'

$sharedArgs = @()
$copilotArgs = @('--all')

for ($i = 0; $i -lt $args.Count; $i += 1) {
  $value = [string]$args[$i]
  switch -Regex ($value) {
    '^--dry-run$' {
      $sharedArgs += $value
      $copilotArgs += $value
      continue
    }
    '^--force$' {
      $sharedArgs += $value
      $copilotArgs += $value
      continue
    }
    '^--profile=.+$' {
      $copilotArgs += $value
      continue
    }
    '^(--minimal|--full|--public|--internal)$' {
      $copilotArgs += $value
      continue
    }
    '^--profile$' {
      if ($i + 1 -ge $args.Count) {
        throw 'Missing value for --profile'
      }
      $copilotArgs += $value
      $i += 1
      $copilotArgs += [string]$args[$i]
      continue
    }
    default {
      throw 'Unknown arg: '
        + "$value (supported: --dry-run, --force, --profile <minimal|full>, --profile=<minimal|full>, --minimal, --full, --public, --internal)"
    }
  }
}

Write-Host '==> Copilot'
& $copilotInstaller @copilotArgs

Write-Host '==> Codex'
& $codexInstaller @sharedArgs

Write-Host '==> Antigravity'
& $antigravityInstaller @sharedArgs

Write-Host '==> OpenCode'
& $opencodeInstaller @sharedArgs
