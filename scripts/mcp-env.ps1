# PSScriptAnalyzerSettings
# @{
#   ExcludeRules = @('PSUseApprovedVerbs')
# }

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
$defaultEnvDir = Join-Path $homeDir ".config\elegy-copilot"
$defaultEnvFile = Join-Path $defaultEnvDir "mcp.env"
$envFile = if ($env:MCP_ENV_FILE) { $env:MCP_ENV_FILE } else { $defaultEnvFile }
$localEnvFile = "$envFile.local"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile. Store MCP secrets outside the repo (for example, $defaultEnvFile) or set MCP_ENV_FILE."
}

$paths = @($envFile)
if (Test-Path -LiteralPath $localEnvFile) { $paths += $localEnvFile }

foreach ($path in $paths) {
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if ($args.Count -gt 0) {
  $cmd, $rest = $args
  & $cmd @rest
  exit $LASTEXITCODE
}

if (Get-Command code -ErrorAction SilentlyContinue) {
  & code "$root"
  exit $LASTEXITCODE
}

Write-Host "VS Code CLI 'code' not found. Open VS Code from this shell to inherit MCP env vars."
