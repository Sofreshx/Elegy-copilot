$ErrorActionPreference = 'Stop'

# Args:
#   0: TargetRepo; default is current directory
#   1: Template; powershell or bash; default is powershell
#   2: HookName; default is exec-automation

$TargetRepo = (Get-Location).Path
$Template = 'powershell'
$HookName = 'exec-automation'

if ($args.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$args[0])) { $TargetRepo = [string]$args[0] }
if ($args.Count -gt 1 -and -not [string]::IsNullOrWhiteSpace([string]$args[1])) { $Template = [string]$args[1] }
if ($args.Count -gt 2 -and -not [string]::IsNullOrWhiteSpace([string]$args[2])) { $HookName = [string]$args[2] }

if (@('powershell', 'bash') -notcontains $Template) {
  throw "Template must be 'powershell' or 'bash'"
}

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($Template -eq 'bash') {
  $templatePath = Join-Path $engineRoot '.github\templates\hooks.bash.json'
} else {
  $templatePath = Join-Path $engineRoot '.github\templates\hooks.powershell.json'
}

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Hook template not found: $templatePath"
}

$targetHooksDir = Join-Path $TargetRepo '.github\hooks'
$targetScriptsDir = Join-Path $TargetRepo 'scripts\hooks'

New-Item -ItemType Directory -Force -Path $targetHooksDir | Out-Null

Copy-Item -Force -LiteralPath $templatePath -Destination (Join-Path $targetHooksDir "$HookName.$Template.json")

# Copy hook scripts folder (idempotent overwrite — mirrors the sh behaviour of rm -rf then cp -R)
$sourceScriptsDir = Join-Path $engineRoot 'scripts\hooks'
if (Test-Path -LiteralPath $targetScriptsDir) {
  Remove-Item -LiteralPath $targetScriptsDir -Recurse -Force
}
$targetScriptsParent = Split-Path -Parent $targetScriptsDir
New-Item -ItemType Directory -Force -Path $targetScriptsParent | Out-Null
Copy-Item -LiteralPath $sourceScriptsDir -Destination $targetScriptsParent -Recurse -Force

Write-Host "Enabled Copilot agent hooks in: $TargetRepo"
Write-Host "- Hook config: $(Join-Path $targetHooksDir "$HookName.$Template.json")"
Write-Host "- Scripts: $targetScriptsDir"
Write-Host "NOTE: Copilot coding agent loads hooks from the repo DEFAULT branch. Commit these files on that branch for enforcement."
