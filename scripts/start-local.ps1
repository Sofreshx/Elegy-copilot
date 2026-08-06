[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'local-operator-common.ps1')

$node = Get-ElegyNodeExecutable
$components = @(Get-ElegyComponentDefinitions -NodeExecutable $node)
Assert-ElegyDependencies -Components $components
$fingerprint = Get-ElegyRepositoryFingerprint
$existing = Read-ElegyOperatorState
if ($null -ne $existing) {
    $existingStatus = Get-ElegyStatusObject -State $existing
    $existingAlive = @($existingStatus.components | Where-Object { $_.alive })
    if ($existingAlive.Count -gt 0) {
        throw "Elegy local services are already tracked and running or unverified. Inspect status-local.ps1 -Json and resolve them manually before starting."
    }
}

$started = @()
try {
    New-Item -ItemType Directory -Force -Path $script:ElegyLogRoot | Out-Null
    foreach ($component in $components) {
        $safeRole = $component.role -replace '[^a-z0-9_-]', '_'
        $stdout = Join-Path $script:ElegyLogRoot "$safeRole.out.log"
        $stderr = Join-Path $script:ElegyLogRoot "$safeRole.err.log"
        $process = Start-Process -FilePath $node -ArgumentList $component.arguments -WorkingDirectory $script:ElegyRepositoryRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
        $started += [ordered]@{
            role = $component.role
            entry = $component.entry
            entry_path = $component.entry_path
            executable = $node
            arguments = $component.arguments
            port = $component.port
            pid = $process.Id
            stdout_log = $stdout
            stderr_log = $stderr
        }
    }
    Write-ElegyOperatorState -State ([ordered]@{
        schema = 'elegy.local.operator-state.v1'
        repository_fingerprint = $fingerprint
        started_at = [DateTime]::UtcNow.ToString('o')
        components = $started
    })
} catch {
    if ($started.Count -gt 0) {
        Write-ElegyOperatorState -State ([ordered]@{
            schema = 'elegy.local.operator-state.v1'
            repository_fingerprint = $fingerprint
            started_at = [DateTime]::UtcNow.ToString('o')
            partial_start = $true
            components = $started
        })
    }
    throw
}

Get-ElegyStatusObject | ConvertTo-Json -Depth 8
