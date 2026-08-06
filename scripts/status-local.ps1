[CmdletBinding()]
param(
    [switch]$Json
)

. (Join-Path $PSScriptRoot 'local-operator-common.ps1')

$result = Get-ElegyStatusObject
if ($Json) {
    $result | ConvertTo-Json -Depth 8
} else {
    Write-Output ("Elegy local services: {0}; verified={1}/2." -f $result.status, @($result.components | Where-Object { $_.verified }).Count)
}
