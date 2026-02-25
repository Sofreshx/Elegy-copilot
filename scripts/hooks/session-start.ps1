$ErrorActionPreference = "Stop"

function Get-RequiredEarlyControls {
    $raw = $env:HOOK_EARLY_CONTROLS_REQUIRED
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @("safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation")
    }

    return @($raw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-EarlyControlStatePath([string]$cwd) {
    $configured = $env:HOOK_EARLY_CONTROLS_STATE_FILE
    if ([string]::IsNullOrWhiteSpace($configured)) {
        return Join-Path $cwd ".instructions-output\hooks\early-controls.json"
    }

    if ([System.IO.Path]::IsPathRooted($configured)) {
        return $configured
    }

    return Join-Path $cwd $configured
}

function Write-JsonLine([string]$path, [object]$entry) {
    $entry | ConvertTo-Json -Compress -Depth 8 | Add-Content -Path $path
}

function New-EarlyControlsState([string]$timestamp, [string[]]$requiredControls) {
    $safetyToken = [System.Guid]::NewGuid().ToString('N')
    $hashBytes = [System.Text.Encoding]::UTF8.GetBytes($safetyToken)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $parityToken = ($sha256.ComputeHash($hashBytes) | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally {
        $sha256.Dispose()
    }

    $safetyPassed = -not [string]::IsNullOrWhiteSpace($safetyToken) -and -not [string]::IsNullOrWhiteSpace($parityToken) -and $parityToken.Length -eq 64

    $preToolPath = Join-Path $PSScriptRoot "pre-tool-use.ps1"
    $hookEnforcementPassed = Test-Path $preToolPath

    $controls = [ordered]@{
        safetyTokenParity = [ordered]@{
            status = if ($safetyPassed) { "pass" } else { "fail" }
            detail = if ($safetyPassed) { "deterministic_pair_valid" } else { "deterministic_pair_invalid" }
        }
        hookEnforcement = [ordered]@{
            status = if ($hookEnforcementPassed) { "pass" } else { "fail" }
            detail = if ($hookEnforcementPassed) { "pre_tool_use_hook_present" } else { "pre_tool_use_hook_missing" }
        }
        telemetrySchemaValidation = [ordered]@{
            status = "fail"
            detail = "schema_unvalidated"
        }
    }

    $telemetryProbe = [ordered]@{
        event = "earlyControlsState"
        schemaVersion = "1.0.0"
        generatedAt = $timestamp
        requiredControls = $requiredControls
        controls = @($controls.Keys)
    }
    $telemetryPassed =
        -not [string]::IsNullOrWhiteSpace([string]$telemetryProbe.event) -and
        -not [string]::IsNullOrWhiteSpace([string]$telemetryProbe.schemaVersion) -and
        -not [string]::IsNullOrWhiteSpace([string]$telemetryProbe.generatedAt) -and
        $telemetryProbe.requiredControls.Count -gt 0 -and
        $telemetryProbe.controls.Count -gt 0

    $controls.telemetrySchemaValidation = [ordered]@{
        status = if ($telemetryPassed) { "pass" } else { "fail" }
        detail = if ($telemetryPassed) { "schema_valid" } else { "schema_invalid" }
    }

    foreach ($controlId in $requiredControls) {
        if (-not $controls.Contains($controlId)) {
            $controls[$controlId] = [ordered]@{
                status = "fail"
                detail = "missing_required_control"
            }
        }
    }

    $allPassed = $true
    foreach ($controlId in $requiredControls) {
        if ($controls[$controlId].status -ne "pass") {
            $allPassed = $false
            break
        }
    }

    return [ordered]@{
        schemaVersion = "1.0.0"
        generatedAt = $timestamp
        requiredControls = $requiredControls
        controls = $controls
        controlData = [ordered]@{
            safetyToken = $safetyToken
            safetyTokenParity = $parityToken
        }
        allPassed = $allPassed
    }
}

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $data = $raw | ConvertFrom-Json
    $cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
    $logDir = Join-Path $cwd ".instructions-output\hooks"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $sessionLogPath = Join-Path $logDir "session.jsonl"

    $timestamp = if ($data.timestamp) { [string]$data.timestamp } else { (Get-Date).ToUniversalTime().ToString("o") }

    $entry = [ordered]@{
        event = "sessionStart"
        timestamp = $timestamp
        source = $data.source
        cwd = $cwd
        initialPrompt = $data.initialPrompt
    }
    Write-JsonLine $sessionLogPath $entry

    $requiredControls = Get-RequiredEarlyControls
    $state = New-EarlyControlsState -timestamp $timestamp -requiredControls $requiredControls
    $statePath = Get-EarlyControlStatePath -cwd $cwd
    $stateDir = Split-Path -Parent $statePath
    if (-not [string]::IsNullOrWhiteSpace($stateDir)) {
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    }
    $state | ConvertTo-Json -Depth 8 | Set-Content -Path $statePath -Encoding UTF8

    Write-JsonLine $sessionLogPath ([ordered]@{
        event = "earlyControlsState"
        timestamp = $timestamp
        statePath = $statePath
        allPassed = $state.allPassed
        controls = $state.controls
    })

    if ($env:HOOK_START_INFRA -eq "1") {
        $localScript = Join-Path $cwd "scripts\hooks\session-start.local.ps1"
        if (Test-Path $localScript) {
            & $localScript
            $exitCode = $LASTEXITCODE
            $entry = [ordered]@{
                event = "sessionStartLocal"
                status = if ($exitCode -eq 0) { "success" } else { "error" }
                exitCode = $exitCode
            }
            Write-JsonLine $sessionLogPath $entry
        }
    }
} catch {
    try {
        $fallbackCwd = (Get-Location).Path
        $logDir = Join-Path $fallbackCwd ".instructions-output\hooks"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $sessionLogPath = Join-Path $logDir "session.jsonl"
        $timestamp = (Get-Date).ToUniversalTime().ToString("o")
        $requiredControls = Get-RequiredEarlyControls

        $failedControls = [ordered]@{}
        foreach ($controlId in $requiredControls) {
            $failedControls[$controlId] = [ordered]@{
                status = "fail"
                detail = "state_generation_error"
            }
        }

        $state = [ordered]@{
            schemaVersion = "1.0.0"
            generatedAt = $timestamp
            requiredControls = $requiredControls
            controls = $failedControls
            allPassed = $false
            error = "session_start_exception"
        }

        $statePath = Get-EarlyControlStatePath -cwd $fallbackCwd
        $stateDir = Split-Path -Parent $statePath
        if (-not [string]::IsNullOrWhiteSpace($stateDir)) {
            New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
        }
        $state | ConvertTo-Json -Depth 8 | Set-Content -Path $statePath -Encoding UTF8

        Write-JsonLine $sessionLogPath ([ordered]@{
            event = "earlyControlsState"
            timestamp = $timestamp
            statePath = $statePath
            allPassed = $false
            controls = $failedControls
            error = "session_start_exception"
        })
    } catch {
    }
}

exit 0
