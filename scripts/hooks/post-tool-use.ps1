$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$resultType = $null
if ($data.toolResult) { $resultType = $data.toolResult.resultType }
$entry = [ordered]@{
    event = "postToolUse"
    timestamp = $data.timestamp
    toolName = $data.toolName
    resultType = $resultType
}
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "post-tool-use.jsonl")
