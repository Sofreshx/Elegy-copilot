# ghcp — PowerShell wrapper for GitHub Copilot CLI with BYOK model routing
# Usage: ghcp <lane> [args...] | ghcp profile <list|current|switch <id>>
#
# Lanes: quick, project, impl, explorer, reviewer, scout

param(
  [Parameter(Position=0)]
  [string]$Command,

  [Parameter(Position=1, ValueFromRemainingArguments)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$GHCP_HOME = if ($env:GHCP_HOME) { $env:GHCP_HOME } else { Join-Path $env:USERPROFILE '.copilot' }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:GHCP_ASSETS) {
  $PROFILES_FILE = Join-Path $env:GHCP_ASSETS 'profiles.json'
} elseif (Test-Path (Join-Path $ScriptDir '..\profiles.json')) {
  $PROFILES_FILE = Join-Path $ScriptDir '..\profiles.json'
} else {
  $PROFILES_FILE = Join-Path $env:USERPROFILE '.config\ghcp\profiles.json'
}

function Read-ActiveProfile {
  $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
  return $p.activeProfile
}

function Read-ProfileField {
  param([string]$ProfileId, [string]$Field)
  $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
  $prof = $p.profiles.$ProfileId
  if (-not $prof) { return '' }
  switch ($Field) {
    'provider.type'     { return $prof.provider.type }
    'provider.baseUrl'  { return $prof.provider.baseUrl }
    'provider.apiKeyEnv'{ return $prof.provider.apiKeyEnv }
    default             { return $prof.$Field }
  }
}

function Resolve-ModelForLane {
  param([string]$ProfileId, [string]$Lane)
  $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
  $prof = $p.profiles.$ProfileId
  if (-not $prof) { return '' }
  $rolesMap = @{
    quick='implementation'; project='planning'; impl='implementation'
    explorer='exploration'; reviewer='review'; scout='research'
  }
  $role = $rolesMap[$Lane]
  if ($role -and $prof.roleModels.$role) { return $prof.roleModels.$role }
  return $prof.small ?? $prof.big
}

function Set-ProviderEnv {
  param([string]$ProfileId)
  $ptype = Read-ProfileField $ProfileId 'provider.type'
  $baseUrl = Read-ProfileField $ProfileId 'provider.baseUrl'
  $apiKeyEnv = Read-ProfileField $ProfileId 'provider.apiKeyEnv'

  $env:COPILOT_PROVIDER_TYPE = if ($ptype) { $ptype } else { 'openai' }
  if ($baseUrl) { $env:COPILOT_PROVIDER_BASE_URL = $baseUrl }
  if ($apiKeyEnv -and (Get-Item "env:$apiKeyEnv" -ErrorAction SilentlyContinue)) {
    $env:COPILOT_PROVIDER_API_KEY = [System.Environment]::GetEnvironmentVariable($apiKeyEnv)
  }
}

function Set-ModelEnv {
  param([string]$ProfileId, [string]$Lane)
  $model = Resolve-ModelForLane $ProfileId $Lane
  if ($model) { $env:COPILOT_MODEL = $model }
}

function Show-Usage {
  @'
Usage: ghcp <command> [args...]

Lanes:
  ghcp quick <prompt>       Small model — 1-2 file tweaks
  ghcp project <prompt>     Big model — roadmap orchestration
  ghcp impl <prompt>        Implementation subagent
  ghcp explorer <prompt>    Exploration subagent
  ghcp reviewer <prompt>    Review subagent
  ghcp scout <prompt>       External research subagent

Profile:
  ghcp profile list         List available profiles
  ghcp profile current      Show active profile
  ghcp profile switch <id>  Switch profile
'@
}

function Invoke-ProfileCommand {
  param([string]$SubCommand, [string[]]$SubArgs)
  switch ($SubCommand) {
    'list' {
      $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
      $active = $p.activeProfile
      foreach ($id in $p.profiles.PSObject.Properties.Name) {
        $prof = $p.profiles.$id
        $marker = if ($id -eq $active) { ' (active)' } else { '' }
        Write-Host "  $id$marker — $($prof.label ?? $id)"
        Write-Host "    $($prof.description ?? '')"
      }
    }
    'current' {
      $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
      $id = $p.activeProfile
      $prof = $p.profiles.$id
      Write-Host "Active profile: $id"
      if ($prof) {
        $base = $prof.provider.baseUrl ?? 'default'
        Write-Host "  Provider: $($prof.provider.type ?? 'openai') → $base"
        Write-Host "  Model: $($prof.roleModels.implementation ?? $prof.small ?? 'unknown')"
      }
    }
    'switch' {
      $target = $SubArgs | Select-Object -First 1
      if (-not $target) { Write-Error 'Usage: ghcp profile switch <profile-id>'; exit 1 }
      $p = Get-Content $PROFILES_FILE -Raw | ConvertFrom-Json
      if (-not $p.profiles.$target) { Write-Error "Profile not found: $target"; exit 1 }
      $p.activeProfile = $target
      $p | ConvertTo-Json -Depth 10 | Set-Content $PROFILES_FILE
      Write-Host "Switched to profile: $target"
    }
    default { Show-Usage }
  }
}

# --- main ---

if (-not $Command) { Show-Usage; exit 0 }

$Lanes = @('quick', 'project', 'impl', 'explorer', 'reviewer', 'scout')

if ($Command -eq 'profile') {
  $SubCommand = $Args | Select-Object -First 1
  $SubArgs = $Args | Select-Object -Skip 1
  Invoke-ProfileCommand -SubCommand $SubCommand -SubArgs $SubArgs
  exit 0
}

if ($Command -in $Lanes) {
  $profile = Read-ActiveProfile
  Set-ProviderEnv $profile
  Set-ModelEnv $profile $Command
  & copilot --agent $Command @Args
  exit $LASTEXITCODE
}

# Pass through to copilot
& copilot $Command @Args
exit $LASTEXITCODE
