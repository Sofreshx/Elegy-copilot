$ErrorActionPreference = 'Stop'

Write-Output "Installing Language Servers for Copilot CLI..."

# 1. TypeScript
Write-Output "`n[1/3] Installing TypeScript Language Server..."
if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm install -g typescript typescript-language-server
    if ($LASTEXITCODE -ne 0) {
        Write-Output "Failed to install TypeScript Language Server (npm exited $LASTEXITCODE)."
    } else {
        Write-Output "TypeScript Language Server installed successfully."
    }
} else {
    Write-Output "Failed to install TypeScript Language Server. npm is not available."
}

# 2. C#
Write-Output "`n[2/3] Installing C# Language Server (OmniSharp)..."
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
    dotnet tool install -g omnisharp
    if ($LASTEXITCODE -ne 0) {
        Write-Output "C# Language Server might already be installed, or installation failed (exit $LASTEXITCODE)."
    } else {
        Write-Output "C# Language Server installed successfully."
    }
} else {
    Write-Output "Failed to install C# Language Server. dotnet is not available."
}

# 3. Rust
Write-Output "`n[3/3] Installing Rust Analyzer..."
if (Get-Command rustup -ErrorAction SilentlyContinue) {
    rustup component add rust-analyzer
    if ($LASTEXITCODE -ne 0) {
        Write-Output "Failed to install Rust Analyzer (rustup exited $LASTEXITCODE)."
    } else {
        Write-Output "Rust Analyzer installed successfully."
    }
} else {
    Write-Output "Failed to install Rust Analyzer. rustup is not available."
}

# Configure lsp-config.json
Write-Output "`nConfiguring lsp-config.json..."

if (-not [string]::IsNullOrWhiteSpace($env:XDG_CONFIG_HOME)) {
    $copilotDir = $env:XDG_CONFIG_HOME
} else {
    $copilotDir = Join-Path $HOME '.copilot'
}
New-Item -ItemType Directory -Force -Path $copilotDir | Out-Null

$lspConfigPath = Join-Path $copilotDir 'lsp-config.json'

$config = @{
    lspServers = @{
        typescript = @{
            command = "typescript-language-server"
            args = @("--stdio")
            fileExtensions = @{
                ".ts" = "typescript"
                ".tsx" = "typescript"
                ".js" = "javascript"
                ".jsx" = "javascript"
            }
        }
        csharp = @{
            command = "omnisharp"
            args = @("--languageserver")
            fileExtensions = @{
                ".cs" = "csharp"
            }
        }
        rust = @{
            command = "rust-analyzer"
            args = @()
            fileExtensions = @{
                ".rs" = "rust"
            }
        }
    }
}

$json = $config | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $lspConfigPath -Value $json -Encoding UTF8

Write-Output "LSP configuration saved to $lspConfigPath"
Write-Output "`nDone! You can now use /lsp in Copilot CLI to verify the servers."
