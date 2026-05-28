$ErrorActionPreference = 'Stop'

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $engineRoot 'scripts\cli-install.mjs'

try {
  $null = Get-Command node -ErrorAction Stop
} catch {
  throw 'Copilot install requires Node.js on PATH (node).'
}

& node $installer @args
