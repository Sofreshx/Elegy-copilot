$ErrorActionPreference = 'Stop'

$engineRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $engineRoot 'scripts\codex-install.mjs'

try {
  $null = Get-Command node -ErrorAction Stop
} catch {
  throw 'Codex install requires Node.js on PATH (node).'
}

& node $installer @args
