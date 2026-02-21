param (
    [switch]$Global = $false
)

$ErrorActionPreference = "Stop"

Write-Output "Installing Language Servers for Copilot CLI..."

# 1. TypeScript
Write-Output "`n[1/3] Installing TypeScript Language Server..."
try {
    npm install -g typescript typescript-language-server
    Write-Output "TypeScript Language Server installed successfully."
} catch {
    Write-Output "Failed to install TypeScript Language Server. Is Node.js/npm installed?"
}

# 2. C#
Write-Output "`n[2/3] Installing C# Language Server (csharp-ls)..."
try {
    dotnet tool install -g csharp-ls
    Write-Output "C# Language Server installed successfully."
} catch {
    Write-Output "Failed to install C# Language Server. It might already be installed, or .NET SDK is missing."
}

# 3. Rust
Write-Output "`n[3/3] Installing Rust Analyzer..."
try {
    rustup component add rust-analyzer
    Write-Output "Rust Analyzer installed successfully."
} catch {
    Write-Output "Failed to install Rust Analyzer. Is rustup installed?"
}

# Configure lsp-config.json
Write-Output "`nConfiguring ~/.copilot/lsp-config.json..."

$copilotDir = Join-Path $HOME ".copilot"
if (-not (Test-Path $copilotDir)) {
    New-Item -ItemType Directory -Path $copilotDir | Out-Null
}

$lspConfigPath = Join-Path $copilotDir "lsp-config.json"

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
            command = "csharp-ls"
            args = @()
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
Set-Content -Path $lspConfigPath -Value $json -Encoding UTF8

Write-Output "LSP configuration saved to $lspConfigPath"
Write-Output "`nDone! You can now use /lsp in Copilot CLI to verify the servers."
