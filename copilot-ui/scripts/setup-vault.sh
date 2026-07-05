#!/usr/bin/env bash
set -euo pipefail

# ── Setup script for Obsidian vault with git versioning ──
# This script:
# 1. Creates the config file ~/.elegy/obsidian-vault.json
# 2. Initializes git in the vault
# 3. Creates .gitignore for Obsidian workspace files
# 4. Makes initial commit

VAULT_PATH="${1:-}"
if [ -z "$VAULT_PATH" ]; then
  # Default to the user's vault path
  VAULT_PATH="/mnt/c/Users/lolzi/Documents/Dev"
fi

ELEGY_HOME="${HOME}/.elegy"
CONFIG_FILE="${ELEGY_HOME}/obsidian-vault.json"

echo "=== Obsidian Vault Setup ==="
echo "Vault path: ${VAULT_PATH}"
echo "Config file: ${CONFIG_FILE}"
echo ""

# 1. Create config file
mkdir -p "${ELEGY_HOME}"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "Creating config file..."
  cat > "${CONFIG_FILE}" << 'CONFIGEOF'
{
  "vaultPath": "VAULT_PATH_PLACEHOLDER",
  "git": {
    "enabled": true,
    "authorName": "User",
    "authorEmail": "user@localhost"
  },
  "gdrive": {
    "enabled": false,
    "remoteFolderName": "Dev-Vault-Backup",
    "credsPath": "CREDS_PATH_PLACEHOLDER",
    "tokenPath": "TOKEN_PATH_PLACEHOLDER"
  },
  "excludeDirs": [".obsidian", ".git", ".trash", "_elegy-copilot", "node_modules"]
}
CONFIGEOF

  # Replace placeholders
  sed -i "s|VAULT_PATH_PLACEHOLDER|${VAULT_PATH}|g" "${CONFIG_FILE}"
  sed -i "s|CREDS_PATH_PLACEHOLDER|${ELEGY_HOME}/gdrive-creds.json|g" "${CONFIG_FILE}"
  sed -i "s|TOKEN_PATH_PLACEHOLDER|${ELEGY_HOME}/gdrive-token.json|g" "${CONFIG_FILE}"

  echo "  Created ${CONFIG_FILE}"
else
  echo "  Config file already exists: ${CONFIG_FILE}"
fi

# 2. Check vault path exists
if [ ! -d "${VAULT_PATH}" ]; then
  echo "ERROR: Vault path does not exist: ${VAULT_PATH}"
  echo "Create the directory first, then re-run this script."
  exit 1
fi

# 3. Initialize git
if [ ! -d "${VAULT_PATH}/.git" ]; then
  echo "Initializing git..."
  cd "${VAULT_PATH}" && git init
  echo "  Git initialized"
else
  echo "  Git already initialized"
fi

# 4. Create .gitignore
GITIGNORE="${VAULT_PATH}/.gitignore"
if [ ! -f "${GITIGNORE}" ]; then
  echo "Creating .gitignore..."
  cat > "${GITIGNORE}" << 'GITIGNOREEOF'
.obsidian/workspace.json
.obsidian/.trash/
.trash/
.DS_Store
Thumbs.db
*.conflict.*.md
GITIGNOREEOF
  echo "  Created .gitignore"
else
  echo "  .gitignore already exists"
fi

# 5. Set git author from config if available
if command -v jq &> /dev/null; then
  AUTHOR_NAME=$(jq -r '.git.authorName // "User"' "${CONFIG_FILE}")
  AUTHOR_EMAIL=$(jq -r '.git.authorEmail // "user@localhost"' "${CONFIG_FILE}")
  cd "${VAULT_PATH}"
  git config user.name "${AUTHOR_NAME}"
  git config user.email "${AUTHOR_EMAIL}"
  echo "  Git author set: ${AUTHOR_NAME} <${AUTHOR_EMAIL}>"
fi

# 6. Initial commit
cd "${VAULT_PATH}"
if git status --porcelain | grep -q .; then
  git add -A
  git commit -m "vault: initial setup with git versioning"
  echo "  Initial commit created"
else
  echo "  No changes to commit"
fi

echo ""
echo "=== Setup Complete ==="
echo "Vault: ${VAULT_PATH}"
echo "Git: $(git rev-parse HEAD 2>/dev/null || echo 'no commits')"
echo ""
echo "Next steps:"
echo "  1. Set IE_OBSIDIAN_VAULT_PATH in your environment"
echo "  2. For Google Drive sync: save gdrive-creds.json to ${ELEGY_HOME}/"
echo "  3. Follow the guide: https://console.cloud.google.com/ → Drive API"
