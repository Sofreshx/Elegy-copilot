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
$promptText = if ($null -ne $data.prompt) { [string]$data.prompt } else { $null }

$baseEntry = [ordered]@{
    event = "userPromptSubmitted"
    timestamp = $data.timestamp
    schemaVersion = $schemaVersion
    optOut = $optOut
}

if ($optOut) {
    $baseEntry.promptLength = if ($null -ne $promptText) { $promptText.Length } else { 0 }
} elseif ($null -ne $promptText -and -not (Test-SensitiveContent $promptText)) {
    $baseEntry.prompt = $promptText
}

$entry = New-AllowlistedEntry -Source $baseEntry -AllowedKeys @("event", "timestamp", "schemaVersion", "optOut", "prompt", "promptLength") -RequiredKeys @("event", "timestamp", "schemaVersion", "optOut")
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "prompts.jsonl")
