$ErrorActionPreference = 'Stop'

$script:ElegyRepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ElegyLocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
$script:ElegyOperatorRoot = Join-Path $script:ElegyLocalAppData 'ElegyCopilot\operator'
$script:ElegyStatePath = Join-Path $script:ElegyOperatorRoot 'state.json'
$script:ElegyLogRoot = Join-Path $script:ElegyOperatorRoot 'logs'

function Get-ElegyNodeExecutable {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $node -or [string]::IsNullOrWhiteSpace([string]$node.Source)) {
        throw "Node.js is required. Install or select it manually, then rerun the source-owned operator script; no dependency installation is attempted."
    }
    return [string]$node.Source
}

function Get-ElegyRepositoryFingerprint {
    $head = & git -C $script:ElegyRepositoryRoot rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$head)) {
        throw "Unable to establish the Elegy repository fingerprint."
    }
    return ([string]$head).Trim()
}

function Get-ElegyComponentDefinitions {
    param([string]$NodeExecutable)

    $trackerEntry = [IO.Path]::GetFullPath((Join-Path $script:ElegyRepositoryRoot 'local-tracker\dist\index.js'))
    $uiEntry = [IO.Path]::GetFullPath((Join-Path $script:ElegyRepositoryRoot 'copilot-ui\server.js'))
    @(
        [pscustomobject]@{
            role = 'tracker'
            entry = 'local-tracker\dist\index.js'
            entry_path = $trackerEntry
            arguments = @($trackerEntry)
            port = 9822
        }
        [pscustomobject]@{
            role = 'copilot-ui'
            entry = 'copilot-ui\server.js'
            entry_path = $uiEntry
            arguments = @($uiEntry, '--host', '127.0.0.1', '--port', '3210')
            port = 3210
        }
    )
}

function Assert-ElegyDependencies {
    param(
        [Parameter(Mandatory = $true)][object[]]$Components
    )

    $null = Get-ElegyNodeExecutable
    if (-not (Test-Path -LiteralPath (Join-Path $script:ElegyRepositoryRoot 'node_modules') -PathType Container)) {
        throw "Elegy dependencies are missing under node_modules. Run the repository's documented install/build steps manually; the operator never installs dependencies."
    }
    foreach ($component in $Components) {
        if (-not (Test-Path -LiteralPath $component.entry_path -PathType Leaf)) {
            throw "Required $($component.role) entrypoint is missing: $($component.entry). Run the repository's documented build step manually; the operator never builds or installs it."
        }
    }
}

function Read-ElegyOperatorState {
    if (-not (Test-Path -LiteralPath $script:ElegyStatePath -PathType Leaf)) {
        return $null
    }
    try {
        return (Get-Content -LiteralPath $script:ElegyStatePath -Raw | ConvertFrom-Json)
    } catch {
        throw "Elegy operator state is malformed. Remove or repair the user-local state after manually checking the processes: $script:ElegyStatePath"
    }
}

function Write-ElegyOperatorState {
    param([Parameter(Mandatory = $true)][object]$State)
    New-Item -ItemType Directory -Force -Path $script:ElegyOperatorRoot, $script:ElegyLogRoot | Out-Null
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:ElegyStatePath -Encoding utf8NoBOM
}

function Get-ElegyProcessEvidence {
    param([Parameter(Mandatory = $true)][object]$Component)

    $pidValue = 0
    try { $pidValue = [int]$Component.pid } catch { $pidValue = 0 }
    if ($pidValue -le 0) {
        return [pscustomobject]@{ role = $Component.role; pid = $pidValue; status = 'stopped'; reason_code = 'pid_missing'; alive = $false; verified = $false; port = $Component.port }
    }
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return [pscustomobject]@{ role = $Component.role; pid = $pidValue; status = 'stopped'; reason_code = 'process_missing'; alive = $false; verified = $false; port = $Component.port }
    }

    $executablePath = $null
    $commandLine = $null
    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
        $executablePath = [string]$cim.ExecutablePath
        $commandLine = [string]$cim.CommandLine
    } catch { }
    $expectedExecutable = [string]$Component.executable
    $executableMatches = -not [string]::IsNullOrWhiteSpace($executablePath) -and
        ([IO.Path]::GetFullPath($executablePath) -eq [IO.Path]::GetFullPath($expectedExecutable))
    $entryMatches = -not [string]::IsNullOrWhiteSpace($commandLine) -and
        $commandLine.Replace('/', '\').ToLowerInvariant().Contains(([string]$Component.entry_path).Replace('/', '\').ToLowerInvariant())
    $verified = $executableMatches -and $entryMatches
    return [pscustomobject]@{
        role = $Component.role
        pid = $pidValue
        status = if ($verified) { 'ready' } else { 'degraded' }
        reason_code = if ($verified) { 'process_verified' } else { 'process_identity_unverified' }
        alive = $true
        verified = $verified
        port = $Component.port
    }
}

function Get-ElegyStatusObject {
    param([object]$State = (Read-ElegyOperatorState))

    $components = @()
    if ($null -ne $State -and $null -ne $State.components) {
        $components = @($State.components | ForEach-Object { Get-ElegyProcessEvidence -Component $_ })
    }
    $alive = @($components | Where-Object { $_.alive })
    $verified = @($components | Where-Object { $_.verified })
    $overall = if ($components.Count -eq 2 -and $verified.Count -eq 2) { 'ready' } elseif ($alive.Count -gt 0) { 'degraded' } else { 'stopped' }
    [ordered]@{
        schema = 'elegy.local.operator-status.v1'
        status = $overall
        repository_fingerprint = if ($null -ne $State) { [string]$State.repository_fingerprint } else { $null }
        components = $components
        checked_at = [DateTime]::UtcNow.ToString('o')
    }
}
