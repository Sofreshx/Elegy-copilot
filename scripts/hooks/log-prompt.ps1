$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$entry = [ordered]@{
    event = "userPromptSubmitted"
    timestamp = $data.timestamp
    prompt = $data.prompt
}
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "prompts.jsonl")
