#!/bin/bash
# =============================================================================
# Relay SQLite Backup Script
# =============================================================================
# Creates a consistent backup of the relay SQLite database using SQLite's
# online backup API. Safe to run while the relay is serving traffic.
#
# Usage:
#   ./relay-backup.sh [backup-dir]
#
# Examples:
#   ./relay-backup.sh                     # Saves to ./backups/
#   ./relay-backup.sh /srv/backups/relay   # Custom directory
#
# The backup file is named relay-YYYYMMDD_HHMMSS.db
# =============================================================================
set -euo pipefail

CONTAINER="${RELAY_CONTAINER:-instruction-engine-relay}"
BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="relay-${TIMESTAMP}.db"
DB_PATH="/app/data/relay.db"
TEMP_BACKUP="/app/data/relay-backup.db"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Verify container is running
if ! docker inspect --format='{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "ERROR: Container '$CONTAINER' is not running" >&2
  exit 1
fi

# Create backup using SQLite's online backup API (atomic, no locking)
echo "Backing up relay database from container '$CONTAINER'..."
docker exec "$CONTAINER" sqlite3 "$DB_PATH" ".backup $TEMP_BACKUP"

# Copy backup out of the container
docker cp "$CONTAINER:$TEMP_BACKUP" "$BACKUP_DIR/$BACKUP_FILE"

# Clean up temp file inside the container
docker exec "$CONTAINER" rm -f "$TEMP_BACKUP"

# Verify the backup
INTEGRITY=$(sqlite3 "$BACKUP_DIR/$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "FAILED")
if [[ "$INTEGRITY" != "ok" ]]; then
  echo "WARNING: Backup integrity check returned: $INTEGRITY" >&2
  echo "The backup file may still be usable — inspect manually." >&2
fi

# Print summary
BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
echo "Backup saved: $BACKUP_DIR/$BACKUP_FILE ($BACKUP_SIZE)"
