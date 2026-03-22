$ErrorActionPreference = 'Stop'
$script:OverwriteMode = $null

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

function Resolve-InstallProfile([string]$value) {
  switch -Regex ($value) {
    '^(?i:minimal|public)$' { return 'minimal' }
    '^(?i:full|internal)$' { return 'full' }
    default { throw "Unsupported install profile: $value (supported: minimal, full, public, internal)" }
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

  if (-not $script:OverwriteMode) {
    try {
      $mode = Read-Host 'Overwrite mode for this run? [a]ll / [e]ach / [n]one (default: each)'
      switch -Regex ($mode) {
        '^(?i:a|all)$' { $script:OverwriteMode = 'all'; break }
        '^(?i:n|none)$' { $script:OverwriteMode = 'none'; break }
        default { $script:OverwriteMode = 'each'; break }
      }
    } catch {
      return $false
    }
  }

  if ($script:OverwriteMode -eq 'all') { return $true }
  if ($script:OverwriteMode -eq 'none') { return $false }

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

function Get-InstallStatePath([string]$root) {
  return (Join-Path $root '.instruction-engine-install-state.json')
}

function Read-InstallState([string]$root) {
  $statePath = Get-InstallStatePath $root
  if (-not (Test-Path -LiteralPath $statePath)) {
    return $null
  }

  try {
    return (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Get-NormalizedInstallStateItems([object[]]$items) {
  if ($null -eq $items) {
    return @()
  }

  return @(
    $items |
      ForEach-Object { [string]$_ } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object -Unique
  )
}

function Write-InstallState(
  [string]$root,
  [string[]]$managedSkills,
  [string[]]$alwaysLoadedSkills,
  [string[]]$vaultSkills,
  [string]$installProfile,
  [string[]]$managedAgents,
  [string[]]$managedPrompts,
  [switch]$DryRun
) {
  $previousState = Read-InstallState $root
  $resolvedManagedAgents =
    if ($PSBoundParameters.ContainsKey('managedAgents')) {
      Get-NormalizedInstallStateItems $managedAgents
    } elseif ($previousState -and $previousState.PSObject.Properties['managedAgents']) {
      Get-NormalizedInstallStateItems @($previousState.managedAgents)
    } else {
      @()
    }
  $resolvedManagedPrompts =
    if ($PSBoundParameters.ContainsKey('managedPrompts')) {
      Get-NormalizedInstallStateItems $managedPrompts
    } elseif ($previousState -and $previousState.PSObject.Properties['managedPrompts']) {
      Get-NormalizedInstallStateItems @($previousState.managedPrompts)
    } else {
      @()
    }
  $statePath = Get-InstallStatePath $root
  $state = [ordered]@{
    schemaVersion = 3
    installProfile = $installProfile
    managedSkills = @(Get-NormalizedInstallStateItems $managedSkills)
    alwaysLoadedSkills = @(Get-NormalizedInstallStateItems $alwaysLoadedSkills)
    vaultSkills = @(Get-NormalizedInstallStateItems $vaultSkills)
    managedAgents = @($resolvedManagedAgents)
    managedPrompts = @($resolvedManagedPrompts)
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] WRITE-STATE $statePath"
    return
  }

  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  Write-Host "[STATE]  $statePath"
}

function Remove-InstallArtifact([string]$artifactPath, [switch]$DryRun) {
  if (-not (Test-Path -LiteralPath $artifactPath)) {
    return
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] PRUNE $artifactPath"
    return
  }

  Remove-Item -LiteralPath $artifactPath -Recurse -Force
  Write-Host "[PRUNE]  $artifactPath"
}

function Prune-ManagedFileInstall(
  [string]$root,
  [string]$relativeDir,
  [string]$statePropertyName,
  [string[]]$currentFiles,
  [string[]]$legacyFileNames,
  [switch]$DryRun
) {
  $previousState = Read-InstallState $root
  $previousFiles = @()
  if ($previousState -and $previousState.PSObject.Properties[$statePropertyName]) {
    $previousFiles = @($previousState.$statePropertyName)
  }

  $currentSet = @(Get-NormalizedInstallStateItems $currentFiles)
  $pruneCandidates = @(
    $currentSet + @($previousFiles) + @($legacyFileNames) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Sort-Object -Unique
  )

  $targetRoot = Join-Path $root $relativeDir
  foreach ($fileName in $pruneCandidates) {
    if ($currentSet -contains $fileName) {
      continue
    }

    Remove-InstallArtifact (Join-Path $targetRoot $fileName) -DryRun:$DryRun
  }
}

function Prune-ManagedSkillInstall(
  [string]$root,
  [string[]]$managedSkills,
  [string[]]$alwaysLoadedSkills,
  [string[]]$vaultSkills,
  [string[]]$legacySkillNames,
  [switch]$DryRun
) {
  $previousState = Read-InstallState $root
  $previousManaged = @()
  $previousVault = @()
  if ($previousState -and $previousState.managedSkills) {
    $previousManaged = @($previousState.managedSkills)
  }
  if ($previousState) {
    if ($previousState.vaultSkills) {
      $previousVault = @($previousState.vaultSkills)
    } elseif ($previousState.managedSkills) {
      $previousVault = @($previousState.managedSkills)
    }
  }

  $managedSet = @($managedSkills | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $alwaysSet = @($alwaysLoadedSkills | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $currentVaultSet = @($vaultSkills | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $pruneCandidates = @($managedSet + $currentVaultSet + $previousManaged + $previousVault + $legacySkillNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)

  $skillsRoot = Join-Path $root 'skills'
  $vaultRoot = Join-Path $root 'skills-vault'

  foreach ($skillName in $pruneCandidates) {
    if ($alwaysSet -contains $skillName) {
      continue
    }

    Remove-InstallArtifact (Join-Path $skillsRoot $skillName) -DryRun:$DryRun
    Remove-InstallArtifact (Join-Path $skillsRoot "$skillName.md") -DryRun:$DryRun
  }

  foreach ($skillName in $pruneCandidates) {
    if ($currentVaultSet -contains $skillName) {
      continue
    }

    Remove-InstallArtifact (Join-Path $vaultRoot $skillName) -DryRun:$DryRun
    Remove-InstallArtifact (Join-Path $vaultRoot "$skillName.md") -DryRun:$DryRun
  }
}

$DryRun = $false
$Force = $false
$DoCli = $false
$DoVscode = $false
$Pointer = $true
$InstallProfile = 'minimal'
$VscodeSettings = $null
$VscodeHome = $null

for ($i = 0; $i -lt $args.Length; $i++) {
  $a = $args[$i]
  if ($a -like '--profile=*') {
    $InstallProfile = $a.Substring('--profile='.Length)
    continue
  }
  switch ($a) {
    '--dry-run' { $DryRun = $true }
    '--force' { $Force = $true }
    '--cli' { $DoCli = $true }
    '--vscode' { $DoVscode = $true }
    '--all' { $DoCli = $true; $DoVscode = $true }
    '--pointer' { $Pointer = $true }
    '--profile' {
      $i++
      if ($i -ge $args.Length) { throw 'Missing value for --profile' }
      $InstallProfile = $args[$i]
    }
    '--minimal' { $InstallProfile = 'minimal' }
    '--public' { $InstallProfile = 'minimal' }
    '--full' { $InstallProfile = 'full' }
    '--internal' { $InstallProfile = 'full' }
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
    default { throw "Unknown arg: $a (supported: --dry-run, --force, --cli, --vscode, --all, --pointer, --profile <minimal|full>, --minimal, --full, --public, --internal, --vscode-settings <path>, --vscode-home <path>)" }
  }
}

$InstallProfile = Resolve-InstallProfile $InstallProfile

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
$legacyManagedSkillNames = @(
  'deployment-compose',
  'debug',
  'design',
  'feature-creator',
  'planning-refactor',
  'playwright-mcp',
  'quality-auditor',
  'semantic-kernel-agents',
  'system-drift',
  'system-editor',
  'system-health',
  'terraform',
  'tech-debt'
)
$legacyManagedAgentFiles = @(
  'context-curator.agent.md',
  'elegy-orchestrator.agent.md',
  'executive.agent.md',
  'executive2.agent.md',
  'executive2-fast.agent.md',
  'executive2-planner.agent.md',
  'executive2p5.agent.md',
  'executive2p5-planner.agent.md'
)
$legacyManagedPromptFiles = @()

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
Write-Host "Profile:      $InstallProfile"
Write-Host "VS Code home: $vscodeHomeResolved"

# Load manifest to determine loadMode for skills in pointer mode.
# Skills with loadMode "always" go to skills/; vault materialization is profile-dependent.
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

$managedSkillNames = @(
  Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object { $_.Name }
)
$managedAgentFiles = @(
  Get-ChildItem -LiteralPath $srcAgentsRoot -Filter '*.agent.md' -File | ForEach-Object { $_.Name }
)
$managedPromptFiles = @(
  Get-ChildItem -LiteralPath $srcPromptsRoot -Filter '*.prompt.md' -File | ForEach-Object { $_.Name }
)
$alwaysLoadedSkillNames = @(
  $managedSkillNames | Where-Object { (Get-SkillLoadMode $_) -eq 'always' }
)
$vaultSkillNames = @(
  if ($InstallProfile -eq 'full') {
    $managedSkillNames
  } else {
    $alwaysLoadedSkillNames
  }
)
Write-Host "Skills:       managed=$($managedSkillNames.Count) always=$($alwaysLoadedSkillNames.Count) on-demand=$($managedSkillNames.Count - $alwaysLoadedSkillNames.Count) vault=$($vaultSkillNames.Count) pointer=$Pointer"


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
  Prune-ManagedFileInstall -root $copilotHome -relativeDir 'agents' -statePropertyName 'managedAgents' -currentFiles $managedAgentFiles -legacyFileNames $legacyManagedAgentFiles -DryRun:$DryRun

  # .github\skills\<skill>\** -> <copilotHome>\skills\<skill>\** (preserve folder)
  if ($Pointer) {
    $vaultDir = Join-Path $copilotHome 'skills-vault'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $vaultDir | Out-Null }
    Write-Host "CLI skills:   installing managed=$($managedSkillNames.Count) always=$($alwaysLoadedSkillNames.Count) on-demand=$($managedSkillNames.Count - $alwaysLoadedSkillNames.Count) vault=$($vaultSkillNames.Count)"
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $skillName = $_.Name
      $loadMode = Get-SkillLoadMode $skillName
      $vaultDst = Join-Path $vaultDir $skillName
      if ($loadMode -eq 'always') {
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        $skillDst = Join-Path (Join-Path $copilotHome 'skills') $skillName
        Sync-Directory $_.FullName $skillDst -DryRun:$DryRun -Force:$Force
      }

      if ($vaultSkillNames -contains $skillName) {
        # Vault installs are profile-dependent. Full installs all managed skills;
        # minimal installs the always-loaded subset only.
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      }
    }

    Prune-ManagedSkillInstall -root $copilotHome -managedSkills $managedSkillNames -alwaysLoadedSkills $alwaysLoadedSkillNames -vaultSkills $vaultSkillNames -legacySkillNames $legacyManagedSkillNames -DryRun:$DryRun
  } else {
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $dstDir = Join-Path (Join-Path $copilotHome 'skills') $_.Name
      Sync-Directory $_.FullName $dstDir -DryRun:$DryRun -Force:$Force
    }
  }

  Write-InstallState -root $copilotHome -managedSkills $managedSkillNames -alwaysLoadedSkills $alwaysLoadedSkillNames -vaultSkills $vaultSkillNames -managedAgents $managedAgentFiles -installProfile $InstallProfile -DryRun:$DryRun

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
  Prune-ManagedFileInstall -root $vscodeHomeResolved -relativeDir 'agents' -statePropertyName 'managedAgents' -currentFiles $managedAgentFiles -legacyFileNames $legacyManagedAgentFiles -DryRun:$DryRun

  if ($Pointer) {
    $vscodeVault = Join-Path $vscodeHomeResolved 'skills-vault'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $vscodeVault | Out-Null }
    Write-Host "VS Code skills: installing managed=$($managedSkillNames.Count) always=$($alwaysLoadedSkillNames.Count) on-demand=$($managedSkillNames.Count - $alwaysLoadedSkillNames.Count) vault=$($vaultSkillNames.Count)"
    Get-ChildItem -LiteralPath $srcSkillsRoot -Directory | ForEach-Object {
      $skillName = $_.Name
      $loadMode = Get-SkillLoadMode $skillName
      $vaultDst = Join-Path $vscodeVault $skillName
      if ($loadMode -eq 'always') {
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        $skillDst = Join-Path (Join-Path $vscodeHomeResolved 'skills') $skillName
        Sync-Directory $_.FullName $skillDst -DryRun:$DryRun -Force:$Force
      }

      if ($vaultSkillNames -contains $skillName) {
        # Vault installs are profile-dependent. Full installs all managed skills;
        # minimal installs the always-loaded subset only.
        Sync-Directory $_.FullName $vaultDst -DryRun:$DryRun -Force:$Force
      }
    }

    Prune-ManagedSkillInstall -root $vscodeHomeResolved -managedSkills $managedSkillNames -alwaysLoadedSkills $alwaysLoadedSkillNames -vaultSkills $vaultSkillNames -legacySkillNames $legacyManagedSkillNames -DryRun:$DryRun
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
  Prune-ManagedFileInstall -root $vscodeHomeResolved -relativeDir 'prompts' -statePropertyName 'managedPrompts' -currentFiles $managedPromptFiles -legacyFileNames $legacyManagedPromptFiles -DryRun:$DryRun

  Write-InstallState -root $vscodeHomeResolved -managedSkills $managedSkillNames -alwaysLoadedSkills $alwaysLoadedSkillNames -vaultSkills $vaultSkillNames -managedAgents $managedAgentFiles -managedPrompts $managedPromptFiles -installProfile $InstallProfile -DryRun:$DryRun

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
