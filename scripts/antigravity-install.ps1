$ErrorActionPreference = 'Stop'

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $engineRoot 'scripts\antigravity-install.mjs'

try {
  $null = Get-Command node -ErrorAction Stop
} catch {
  throw 'Antigravity install requires Node.js on PATH (node).'
}

& node $installer @args
