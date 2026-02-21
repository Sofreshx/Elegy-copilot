$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$server = Join-Path $repoRoot 'copilot-ui\server.js'

if (-not (Test-Path -LiteralPath $server)) {
  throw "Missing server entrypoint: $server"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Missing 'node' on PATH."
}

& node $server @args
exit $LASTEXITCODE

