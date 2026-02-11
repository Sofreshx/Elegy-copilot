$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$data = $raw | ConvertFrom-Json
$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }
$logDir = Join-Path $cwd ".instructions-output\hooks"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$entry = [ordered]@{
    event = "sessionStart"
    timestamp = $data.timestamp
    source = $data.source
    cwd = $cwd
    initialPrompt = $data.initialPrompt
}
$entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "session.jsonl")

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
        $entry | ConvertTo-Json -Compress | Add-Content -Path (Join-Path $logDir "session.jsonl")
    }
}
