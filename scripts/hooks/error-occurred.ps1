$ErrorActionPreference = "Stop"

$schemaVersion = "1.0.0"

function Test-OptOutEnabled {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $normalized = $Value.Trim().ToLowerInvariant()
    return $normalized -in @("1", "true", "yes", "on")
}

function Test-SensitiveContent {
    param(
        [AllowNull()][string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }

    $patterns = @(
        '(?is)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----',
        '(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*\S+',
        '(?i)\bauthorization\b\s*:\s*(?:bearer|basic)\s+\S+',
        '(?i)\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b',
        '(?i)\bsk-[A-Za-z0-9]{20,}\b'
    )

    foreach ($pattern in $patterns) {
        if ($Value -match $pattern) {
            return $true
        }
    }

    return $false
}

function New-AllowlistedEntry {
    param(
        [System.Collections.IDictionary]$Source,
        [string[]]$AllowedKeys,
        [string[]]$RequiredKeys
    )

    $entry = [ordered]@{}
    foreach ($key in $AllowedKeys) {
        if ($Source.Contains($key)) {
            $value = $Source[$key]
            if ($null -ne $value -or $RequiredKeys -contains $key) {
                $entry[$key] = $value
            }
        }
    }

    return $entry
}

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$optOut = Test-OptOutEnabled $env:HOOK_TELEMETRY_OPTOUT

$name = $null
$message = $null
if ($data.error) {
    if ($null -ne $data.error.name) { $name = [string]$data.error.name }
    if ($null -ne $data.error.message) { $message = [string]$data.error.message }
}

$baseEntry = [ordered]@{
    event = "errorOccurred"
    timestamp = $data.timestamp
    schemaVersion = $schemaVersion
    optOut = $optOut
}

if ($null -ne $name -and -not (Test-SensitiveContent $name)) {
    $baseEntry.name = $name
}
if (-not $optOut -and $null -ne $message -and -not (Test-SensitiveContent $message)) {
    $baseEntry.message = $message
}

$entry = New-AllowlistedEntry -Source $baseEntry -AllowedKeys @("event", "timestamp", "schemaVersion", "optOut", "name", "message") -RequiredKeys @("event", "timestamp", "schemaVersion", "optOut")
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "errors.jsonl")
