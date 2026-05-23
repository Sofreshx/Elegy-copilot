$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$server = Join-Path $repoRoot 'copilot-ui\server.js'

if (-not (Test-Path -LiteralPath $server)) {
  throw "Missing server entrypoint: $server"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Missing 'node' on PATH."
}

$forwardedArgs = @()
$sdkBridgeRequested = $false

foreach ($arg in $args) {
  if ($arg -eq '--sdk') {
    $sdkBridgeRequested = $true
    continue
  }

  $forwardedArgs += $arg
}

$exitCode = 0

if (-not $sdkBridgeRequested) {
  & node $server @forwardedArgs
  exit $LASTEXITCODE
}

$hadPreviousSdkBridge = Test-Path Env:COPILOT_SDK_BRIDGE
$previousSdkBridge = if ($hadPreviousSdkBridge) {
  (Get-Item Env:COPILOT_SDK_BRIDGE).Value
} else {
  $null
}

try {
  $env:COPILOT_SDK_BRIDGE = '1'
  & node $server @forwardedArgs
  $exitCode = $LASTEXITCODE
} finally {
  if ($hadPreviousSdkBridge) {
    $env:COPILOT_SDK_BRIDGE = $previousSdkBridge
  } elseif (Test-Path Env:COPILOT_SDK_BRIDGE) {
    Remove-Item Env:COPILOT_SDK_BRIDGE
  }
}

exit $exitCode
