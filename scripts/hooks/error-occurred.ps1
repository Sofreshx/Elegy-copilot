$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$name = $null
$message = $null
if ($data.error) {
    $name = $data.error.name
    $message = $data.error.message
}
$entry = [ordered]@{
    event = "errorOccurred"
    timestamp = $data.timestamp
    name = $name
    message = $message
}
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "errors.jsonl")
