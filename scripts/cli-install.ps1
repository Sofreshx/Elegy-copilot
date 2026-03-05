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

function Get-VscodeHome {
  param(
    [string]$Explicit
  )

  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
	return [System.IO.Path]::GetFullPath($Explicit)
  }

  if (-not [string]::IsNullOrWhiteSpace($env:INSTRUCTION_ENGINE_VSCODE_HOME)) {
	return [System.IO.Path]::GetFullPath($env:INSTRUCTION_ENGINE_VSCODE_HOME)
  }

  return (Join-Path $HOME '.copilot')
}

function Confirm-NodeAvailable {
  try {
    $null = Get-Command node -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Test-FilesEqual([string]$a, [string]$b) {
  if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
  $ha = (Get-FileHash -Algorithm SHA256 -LiteralPath $a).Hash
  $hb = (Get-FileHash -Algorithm SHA256 -LiteralPath $b).Hash
  return $ha -eq $hb
}

function Get-DirectoryHash([string]$dir) {
  try {
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $items = Get-ChildItem -LiteralPath $dir -Recurse -File | Sort-Object FullName
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      foreach ($it in $items) {
        $rel = $it.FullName.Substring($dir.Length).TrimStart('\\','/')
        $relBytes = [System.Text.Encoding]::UTF8.GetBytes(($rel -replace '\\','/') + "`0")
        $null = $sha.TransformBlock($relBytes, 0, $relBytes.Length, $null, 0)

        $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $it.FullName).Hash
        $hashBytes = [System.Text.Encoding]::UTF8.GetBytes($fileHash + "`n")
        $null = $sha.TransformBlock($hashBytes, 0, $hashBytes.Length, $null, 0)
      }
      $null = $sha.TransformFinalBlock(@(), 0, 0)
      return ($sha.Hash | ForEach-Object ToString x2) -join ''
    } finally {
      $sha.Dispose()
    }
  } catch {
    return $null
  }
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

function Sync-Directory([string]$srcDir, [string]$dstDir, [switch]$DryRun, [switch]$Force) {
  if (-not (Test-Path -LiteralPath $srcDir)) {
    throw "Source directory not found: $srcDir"
  }

  $dstParent = Split-Path -Parent $dstDir
  if ($DryRun) {
    if (-not (Test-Path -LiteralPath $dstParent)) { Write-Host "[DRY-RUN] mkdir $dstParent" }
  } else {
    New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
  }

  if (-not (Test-Path -LiteralPath $dstDir)) {
    if ($DryRun) {
      Write-Host "[DRY-RUN] CREATE-DIR $dstDir"
    } else {
      Copy-Item -LiteralPath $srcDir -Destination $dstDir -Recurse -Force
      Write-Host "[CREATE] $dstDir"
    }
    return
  }

  $srcHash = Get-DirectoryHash $srcDir
  $dstHash = Get-DirectoryHash $dstDir
  if ($srcHash -and $dstHash -and $srcHash -eq $dstHash) {
    Write-Host "[SKIP]   $dstDir (up-to-date)"
    return
  }

  if ($DryRun -and -not $Force) {
    Write-Host "[DRY-RUN] WOULD-UPDATE-DIR $dstDir (differs; re-run with --force to overwrite)"
    return
  }

  $shouldOverwrite = $Force -or (Confirm-Overwrite $dstDir)
  if (-not $shouldOverwrite) {
    Write-Host "[SKIP]   $dstDir (differs; re-run with --force to overwrite)"
    return
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] UPDATE-DIR $dstDir"
  } else {
    Remove-Item -LiteralPath $dstDir -Recurse -Force
    Copy-Item -LiteralPath $srcDir -Destination $dstDir -Recurse -Force
    Write-Host "[UPDATE] $dstDir"
  }
}

$DryRun = $false
$Force = $false
$DoCli = $false
$DoVscode = $false
$Pointer = $true
$VscodeSettings = $null
$VscodeHome = $null

for ($i = 0; $i -lt $args.Length; $i++) {
  $a = $args[$i]
  switch ($a) {
    '--dry-run' { $DryRun = $true }
    '--force' { $Force = $true }
    '--cli' { $DoCli = $true }
    '--vscode' { $DoVscode = $true }
    '--all' { $DoCli = $true; $DoVscode = $true }
    '--pointer' { $Pointer = $true }
    '--vscode-settings' {
      $i++
      if ($i -ge $args.Length) { throw 'Missing value for --vscode-settings' }
      $VscodeSettings = $args[$i]
    }
    '--vscode-home' {
      $i++
      if ($i -ge $args.Length) { throw 'Missing value for --vscode-home' }
      $VscodeHome = $args[$i]
    }
    default { throw "Unknown arg: $a (supported: --dry-run, --force, --cli, --vscode, --all, --pointer, --vscode-settings <path>, --vscode-home <path>)" }
  }
}

if (-not $DoCli -and -not $DoVscode) {
  $DoCli = $true
  $DoVscode = $true
}

$engineRoot = Get-EngineRoot
$srcAssetsRoot = Join-Path $engineRoot 'engine-assets'
$srcAgentsRoot = Join-Path $srcAssetsRoot 'agents'
$srcSkillsRoot = Join-Path $srcAssetsRoot 'skills'
$srcPromptsRoot = Join-Path $srcAssetsRoot 'prompts'
$srcInstructions = Join-Path $srcAssetsRoot 'copilot-instructions.md'
$srcVscodeInstructions = Join-Path $engineRoot '.github\copilot-instructions.md'

if ($DoCli) {
  if (-not (Test-Path -LiteralPath $srcAgentsRoot)) { throw "Missing agents source: $srcAgentsRoot" }
  if (-not (Test-Path -LiteralPath $srcSkillsRoot)) { throw "Missing skills source: $srcSkillsRoot" }
  if (-not (Test-Path -LiteralPath $srcInstructions)) { throw "Missing instructions source: $srcInstructions" }
}

if ($DoVscode) {
  if (-not (Test-Path -LiteralPath $srcPromptsRoot)) { throw "Missing prompt sources: $srcPromptsRoot" }
  if (-not (Test-Path -LiteralPath $srcAgentsRoot)) { throw "Missing agents source: $srcAgentsRoot" }
  if (-not (Test-Path -LiteralPath $srcSkillsRoot)) { throw "Missing skills source: $srcSkillsRoot" }
  if (-not (Test-Path -LiteralPath $srcVscodeInstructions)) { throw "Missing VS Code instructions source: $srcVscodeInstructions" }
}

$copilotHome = Get-CopilotHome

$vscodeHomeResolved = Get-VscodeHome -Explicit $VscodeHome

Write-Host "Copilot home: $copilotHome"
Write-Host "Engine root:  $engineRoot"
Write-Host "Modes:        cli=$DoCli vscode=$DoVscode"
Write-Host "VS Code home: $vscodeHomeResolved"

# Load manifest to determine loadMode for skills in pointer mode.
# Skills with loadMode "always" go to skills/ (full); others go vault-only.
$manifestPath = Join-Path $srcAssetsRoot 'manifest.json'
$manifestData = $null
if (Test-Path -LiteralPath $manifestPath) {
  try { $manifestData = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { }
}

function Get-SkillLoadMode([string]$skillName) {
  if (-not $manifestData -or -not $manifestData.assets) { return 'on-demand' }
  $asset = $manifestData.assets | Where-Object { $_.type -eq 'skill' -and $_.source -and $_.source.EndsWith("/$skillName") } | Select-Object -First 1
  if ($asset -and $asset.loadMode) { return $asset.loadMode }
  return 'on-demand'
}


if ($DoCli) {
  if ($DryRun) {
    if (-not (Test-Path -LiteralPath $copilotHome)) { Write-Host "[DRY-RUN] mkdir $copilotHome" }
  } else {
    New-Item -ItemType Directory -Force -Path $copilotHome | Out-Null
  }

  # .github\agents\*.agent.md -> <copilotHome>\agents\ (flatten)
  Get-ChildItem -LiteralPath $srcAgentsRoot -Filter '*.agent.md' -File | ForEach-Object {
    $dst = Join-Path $copilotHome (Join-Path 'agents' $_.Name)
    Sync-File $_.FullName $dst -DryRun:$DryRun -Force:$Force
  }

  # .github\skills\<skill>\** -> <copilotHome>\skills\<skill>\** (preserve folder)
  if ($Pointer) {
    $vaultDir = Join-Path $copilotHome 'skills-vault'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $vaultDir | Out-Null }
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $skillName = $_.Name
      $loadMode = Get-SkillLoadMode $skillName
      $vaultDst = Join-Path $vaultDir $skillName
      if ($loadMode -eq 'always') {
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        $skillDst = Join-Path (Join-Path $copilotHome 'skills') $skillName
        Sync-Directory $_.FullName $skillDst -DryRun:$DryRun -Force:$Force
        # Also copy to vault for search index consistency
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      } else {
        # On-demand: vault only — NOT in skills/ scan path
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      }
    }
  } else {
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $dstDir = Join-Path (Join-Path $copilotHome 'skills') $_.Name
      Sync-Directory $_.FullName $dstDir -DryRun:$DryRun -Force:$Force
    }
  }

  # engine-assets/copilot-instructions.md -> <copilotHome>\copilot-instructions.md
  $dstInstructions = Join-Path $copilotHome 'copilot-instructions.md'
  Sync-File $srcInstructions $dstInstructions -DryRun:$DryRun -Force:$Force
}

if ($DoVscode) {
  if ($DryRun) {
    if (-not (Test-Path -LiteralPath $vscodeHomeResolved)) { Write-Host "[DRY-RUN] mkdir $vscodeHomeResolved" }
  } else {
    New-Item -ItemType Directory -Force -Path $vscodeHomeResolved | Out-Null
  }

  # Install VS Code discoverable assets into the VS Code user asset home (NOT ~/.copilot).
  Get-ChildItem -LiteralPath $srcAgentsRoot -Filter '*.agent.md' -File | ForEach-Object {
    $dst = Join-Path (Join-Path $vscodeHomeResolved 'agents') $_.Name
    Sync-File $_.FullName $dst -DryRun:$DryRun -Force:$Force
  }

  if ($Pointer) {
    $vscodeVault = Join-Path $vscodeHomeResolved 'skills-vault'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $vscodeVault | Out-Null }
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $skillName = $_.Name
      $loadMode = Get-SkillLoadMode $skillName
      $vaultDst = Join-Path $vscodeVault $skillName
      if ($loadMode -eq 'always') {
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        $skillDst = Join-Path (Join-Path $vscodeHomeResolved 'skills') $skillName
        Sync-Directory $_.FullName $skillDst -DryRun:$DryRun -Force:$Force
        # Also copy to vault for search index consistency
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      } else {
        # On-demand: vault only — NOT in skills/ scan path
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      }
    }
  } else {
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $dstDir = Join-Path (Join-Path $vscodeHomeResolved 'skills') $_.Name
      Sync-Directory $_.FullName $dstDir -DryRun:$DryRun -Force:$Force
    }
  }

  Get-ChildItem -LiteralPath $srcPromptsRoot -Filter '*.prompt.md' -File | ForEach-Object {
    $dst = Join-Path (Join-Path $vscodeHomeResolved 'prompts') $_.Name
    Sync-File $_.FullName $dst -DryRun:$DryRun -Force:$Force
  }

  $dstVscodeInstructions = Join-Path $vscodeHomeResolved 'copilot-instructions.md'
  Sync-File $srcVscodeInstructions $dstVscodeInstructions -DryRun:$DryRun -Force:$Force

  if (-not (Confirm-NodeAvailable)) {
    throw 'VS Code setup requires Node.js on PATH (node). Install Node.js, or rerun with --cli to skip VS Code setup.'
  }

  $patcher = Join-Path $engineRoot 'scripts\\vscode-settings-patch.mjs'
  if (-not (Test-Path -LiteralPath $patcher)) {
    throw "Missing settings patcher script: $patcher"
  }

  $nodeArgs = @($patcher, '--vscode-home', $vscodeHomeResolved)
  if ($DryRun) { $nodeArgs += '--dry-run' }
  if ($VscodeSettings) { $nodeArgs += @('--settings', $VscodeSettings) }

  Write-Host "Patching VS Code settings via node: $patcher"
  & node @nodeArgs
}

Write-Host 'Done.'

