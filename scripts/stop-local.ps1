[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'local-operator-common.ps1')

$state = Read-ElegyOperatorState
if ($null -eq $state) {
    [ordered]@{ schema = 'elegy.local.operator-status.v1'; status = 'stopped'; reason_code = 'operator_state_missing'; components = @(); checked_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 8
    exit 0
}

$fingerprint = Get-ElegyRepositoryFingerprint
if ([string]$state.repository_fingerprint -ne $fingerprint) {
    throw "Repository fingerprint changed since startup; refusing to stop unverified processes. Inspect and stop them manually."
}

$evidence = @($state.components | ForEach-Object { Get-ElegyProcessEvidence -Component $_ })
$unsafe = @($evidence | Where-Object { $_.alive -and -not $_.verified })
if ($unsafe.Count -gt 0) {
    throw "Refusing to stop unverified process identity for: $($unsafe.role -join ', '). Inspect the process manually."
}

foreach ($item in $evidence | Where-Object { $_.alive -and $_.verified }) {
    Stop-Process -Id ([int]$item.pid) -Force -ErrorAction Stop
}
Remove-Item -LiteralPath $script:ElegyStatePath -Force -ErrorAction SilentlyContinue
[ordered]@{ schema = 'elegy.local.operator-status.v1'; status = 'stopped'; reason_code = 'operator_stop_completed'; components = $evidence; checked_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 8
