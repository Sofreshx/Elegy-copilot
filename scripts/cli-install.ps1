$ErrorActionPreference = 'Stop'

function Get-CopilotHome {
  if (-not [string]::IsNullOrWhiteSpace($env:XDG_CONFIG_HOME)) {
    # Copilot CLI treats XDG_CONFIG_HOME as an override for the entire config dir
    # (default is already $HOME/.copilot), so do not append extra path segments.
    return $env:XDG_CONFIG_HOME
  }

  return (Join-Path $HOME '.copilot')
}

function Get-EngineRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Test-FilesEqual([string]$a, [string]$b) {
  if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
  $ha = (Get-FileHash -Algorithm SHA256 -LiteralPath $a).Hash
  $hb = (Get-FileHash -Algorithm SHA256 -LiteralPath $b).Hash
  return $ha -eq $hb
}

function Confirm-Overwrite([string]$path) {
  try {
    if ([Console]::IsInputRedirected) { return $false }
  } catch { }

  try {
    $resp = Read-Host "Overwrite $path ? [y/N]"
    return $resp -match '^(y|yes)$'
  } catch {
    return $false
  }
}

function Sync-File([string]$src, [string]$dst, [switch]$DryRun, [switch]$Force) {
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Source file not found: $src"
  }

  $dstDir = Split-Path -Parent $dst
  if (-not [string]::IsNullOrWhiteSpace($dstDir)) {
    if ($DryRun) {
      if (-not (Test-Path -LiteralPath $dstDir)) { Write-Host "[DRY-RUN] mkdir $dstDir" }
    } else {
      New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    }
  }

  if (-not (Test-Path -LiteralPath $dst)) {
    if ($DryRun) {
      Write-Host "[DRY-RUN] CREATE $dst"
    } else {
      Copy-Item -Force -LiteralPath $src -Destination $dst
      Write-Host "[CREATE] $dst"
    }
    return
  }

  if (Test-FilesEqual $src $dst) {
    Write-Host "[SKIP]   $dst (up-to-date)"
    return
  }

  if ($DryRun -and -not $Force) {
    Write-Host "[DRY-RUN] WOULD-UPDATE $dst (differs; re-run with --force to overwrite)"
    return
  }

  $shouldOverwrite = $Force -or (Confirm-Overwrite $dst)
  if (-not $shouldOverwrite) {
    Write-Host "[SKIP]   $dst (differs; re-run with --force to overwrite)"
    return
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] UPDATE $dst"
  } else {
    Copy-Item -Force -LiteralPath $src -Destination $dst
    Write-Host "[UPDATE] $dst"
  }
}

$DryRun = $false
$Force = $false
foreach ($a in $args) {
  switch ($a) {
    '--dry-run' { $DryRun = $true }
    '--force' { $Force = $true }
    default { throw "Unknown arg: $a (supported: --dry-run, --force)" }
  }
}

$engineRoot = Get-EngineRoot
$sourceRoot = Join-Path $engineRoot '.cli'
if (-not (Test-Path -LiteralPath $sourceRoot)) {
  throw "Missing source folder: $sourceRoot"
}

$copilotHome = Get-CopilotHome
if ($DryRun) {
  if (-not (Test-Path -LiteralPath $copilotHome)) { Write-Host "[DRY-RUN] mkdir $copilotHome" }
} else {
  New-Item -ItemType Directory -Force -Path $copilotHome | Out-Null
}

Write-Host "Copilot home: $copilotHome"
Write-Host "Source:       $sourceRoot"

# .cli\agents\*.agent.md -> <copilotHome>\agents\ (flatten)
$srcAgents = Join-Path $sourceRoot 'agents'
Get-ChildItem -LiteralPath $srcAgents -Filter '*.agent.md' -File | ForEach-Object {
  $dst = Join-Path $copilotHome (Join-Path 'agents' $_.Name)
  Sync-File $_.FullName $dst -DryRun:$DryRun -Force:$Force
}

# .cli\skills\**\SKILL.md -> <copilotHome>\skills\... (preserve folder)
$srcSkills = Join-Path $sourceRoot 'skills'
Get-ChildItem -LiteralPath $srcSkills -Filter 'SKILL.md' -Recurse -File | ForEach-Object {
  $relDir = $_.Directory.FullName.Substring($srcSkills.Length).TrimStart('\', '/')
  $dstDir = if ([string]::IsNullOrWhiteSpace($relDir)) {
    Join-Path $copilotHome 'skills'
  } else {
    Join-Path (Join-Path $copilotHome 'skills') $relDir
  }
  $dst = Join-Path $dstDir 'SKILL.md'
  Sync-File $_.FullName $dst -DryRun:$DryRun -Force:$Force
}

# .cli\instructions\copilot-instructions.md -> <copilotHome>\copilot-instructions.md
$srcInstructions = Join-Path $sourceRoot 'instructions\copilot-instructions.md'
$dstInstructions = Join-Path $copilotHome 'copilot-instructions.md'
Sync-File $srcInstructions $dstInstructions -DryRun:$DryRun -Force:$Force

Write-Host 'Done.'

