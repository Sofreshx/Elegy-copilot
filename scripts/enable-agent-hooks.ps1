$ErrorActionPreference = 'Stop'

# Args:
#   0: TargetRepo; default is current directory
#   1: Template; powershell or bash; default is powershell
#   2: HookName; default is exec-automation
function Test-HasArg([int]$index) {
  return $args.Count -gt $index -and -not [string]::IsNullOrWhiteSpace([string]$args[$index])
}

$TargetRepo = (Get-Location).Path
$Template = 'powershell'
$HookName = 'exec-automation'

if (Test-HasArg 0) { $TargetRepo = [string]$args[0] }
if (Test-HasArg 1) { $Template = [string]$args[1] }
if (Test-HasArg 2) { $HookName = [string]$args[2] }

if (@('powershell', 'bash') -notcontains $Template) {
  throw "Template must be 'powershell' or 'bash'"
}

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ($Template -eq 'bash') {
  $templatePath = Join-Path $engineRoot '.github\templates\hooks.bash.json'
} else {
  $templatePath = Join-Path $engineRoot '.github\templates\hooks.powershell.json'
}

if (-not (Test-Path $templatePath)) {
  throw "Hook template not found: $templatePath"
}

$targetHooksDir = Join-Path $TargetRepo '.github\hooks'
$targetScriptsDir = Join-Path $TargetRepo 'scripts\hooks'

New-Item -ItemType Directory -Force -Path $targetHooksDir | Out-Null
New-Item -ItemType Directory -Force -Path $targetScriptsDir | Out-Null

Copy-Item -Force $templatePath (Join-Path $targetHooksDir "$HookName.$Template.json")

# Copy the hook scripts contents (idempotent overwrite)
$sourceScriptsDir = Join-Path $engineRoot 'scripts\hooks'
Copy-Item -Recurse -Force (Join-Path $sourceScriptsDir '*') $targetScriptsDir

Write-Host "Enabled Copilot agent hooks in: $TargetRepo"
Write-Host "- Hook config: $(Join-Path $targetHooksDir "$HookName.$Template.json")"
Write-Host "- Scripts: $targetScriptsDir"
Write-Host "NOTE: Copilot coding agent loads hooks from the repo DEFAULT branch. Commit these files on that branch for enforcement."
