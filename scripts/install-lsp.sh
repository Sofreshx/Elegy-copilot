#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "\033[1;36mInstalling Language Servers for Copilot CLI...\033[0m"

# 1. TypeScript
echo -e "\n\033[1;33m[1/3] Installing TypeScript Language Server...\033[0m"
if command -v npm &> /dev/null; then
    npm install -g typescript typescript-language-server
    echo -e "\033[1;32mTypeScript Language Server installed successfully.\033[0m"
else
    echo -e "\033[1;31mFailed to install TypeScript Language Server. npm is not installed.\033[0m"
fi

# 2. C#
echo -e "\n\033[1;33m[2/3] Installing C# Language Server (OmniSharp)...\033[0m"
if command -v dotnet &> /dev/null; then
    dotnet tool install -g omnisharp || echo -e "\033[1;33mC# Language Server might already be installed.\033[0m"
    echo -e "\033[1;32mC# Language Server installed successfully.\033[0m"
else
    echo -e "\033[1;31mFailed to install C# Language Server. dotnet is not installed.\033[0m"
fi

# 3. Rust
echo -e "\n\033[1;33m[3/3] Installing Rust Analyzer...\033[0m"
if command -v rustup &> /dev/null; then
    rustup component add rust-analyzer
    echo -e "\033[1;32mRust Analyzer installed successfully.\033[0m"
else
    echo -e "\033[1;31mFailed to install Rust Analyzer. rustup is not installed.\033[0m"
fi

# Configure lsp-config.json
echo -e "\n\033[1;33mConfiguring ~/.copilot/lsp-config.json...\033[0m"

if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  COPILOT_DIR="$XDG_CONFIG_HOME"
else
  COPILOT_DIR="$HOME/.copilot"
fi
mkdir -p "$COPILOT_DIR"

LSP_CONFIG_PATH="$COPILOT_DIR/lsp-config.json"

cat > "$LSP_CONFIG_PATH" << 'EOF'
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": [
        "--stdio"
      ],
      "fileExtensions": {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript"
      }
    },
    "csharp": {
      "command": "omnisharp",
      "args": [
        "--languageserver"
      ],
      "fileExtensions": {
        ".cs": "csharp"
      }
    },
    "rust": {
      "command": "rust-analyzer",
      "args": [],
      "fileExtensions": {
        ".rs": "rust"
      }
    }
  }
}
EOF

echo -e "\033[1;32mLSP configuration saved to $LSP_CONFIG_PATH\033[0m"
echo -e "\n\033[1;36mDone! You can now use /lsp in Copilot CLI to verify the servers.\033[0m"
