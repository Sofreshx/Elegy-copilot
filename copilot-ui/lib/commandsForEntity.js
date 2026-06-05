'use strict';

const path = require('path');

const VALID_ENTITY_TYPES = Object.freeze(new Set([
  'roadmap',
  'goal',
  'plan',
  'todo',
  'work-point',
  'review-point',
]));

/**
 * Normalize and validate an entity type string.
 * Returns the lowercased type, or null if invalid.
 */
function normalizeEntityType(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return VALID_ENTITY_TYPES.has(trimmed) ? trimmed : null;
}

/**
 * Normalize a string value: trim whitespace, return null if empty.
 */
function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Escape a string for safe use in a shell command.
 * Wraps the value in double quotes and escapes inner double quotes and backslashes.
 */
function escapeShellArg(value) {
  const raw = String(value == null ? '' : value);
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
  return '"' + escaped + '"';
}

/**
 * Build the common CLI prefix: elegy-planning --db "<dbPath>"
 */
function buildCliPrefix(dbPath) {
  const db = normalizeOptionalString(dbPath) || '';
  return 'elegy-planning --db ' + escapeShellArg(db);
}

/**
 * Build a command for showing an entity:
 *   elegy-planning --db "<dbPath>" <entityType> show --<entityType>-id <entityId>
 */
function buildShowCommand(prefix, entityType, entityId) {
  const flag = '--' + entityType + '-id';
  return prefix + ' ' + entityType + ' show ' + flag + ' ' + escapeShellArg(entityId);
}

/**
 * Build a command for listing work points by roadmap:
 *   elegy-planning --db "<dbPath>" work-point list --roadmap-id <roadmapId>
 */
function buildWorkPointListCommand(prefix, entityId) {
  return prefix + ' work-point list --roadmap-id ' + escapeShellArg(entityId);
}

/**
 * Build a command for listing roadmaps by goal:
 *   elegy-planning --db "<dbPath>" roadmap list --goal-id <goalId>
 */
function buildRoadmapListCommand(prefix, entityId) {
  return prefix + ' roadmap list --goal-id ' + escapeShellArg(entityId);
}

/**
 * Build a command for listing tags:
 *   elegy-planning --db "<dbPath>" tags --entity-type <entityType> --entity-id <entityId>
 */
function buildTagsCommand(prefix, entityType, entityId) {
  return prefix + ' tags --entity-type ' + entityType + ' --entity-id ' + escapeShellArg(entityId);
}

/**
 * Build a command for validating an entity:
 *   elegy-planning --db "<dbPath>" validate --entity-type <entityType> --entity-id <entityId>
 */
function buildValidateCommand(prefix, entityType, entityId) {
  return prefix + ' validate --entity-type ' + entityType + ' --entity-id ' + escapeShellArg(entityId);
}

/**
 * Build an array of copyable CLI commands for an entity.
 *
 * @param {object} entity - Entity object with at least { entityType, entityId }
 * @param {string} dbPath - Path to the elegy-planning SQLite database
 * @returns {string[]} Ordered array of CLI command strings
 */
function buildCopyableCliCommands(entity, dbPath) {
  if (!entity || typeof entity !== 'object') {
    return [];
  }

  const entityType = normalizeEntityType(entity.entityType);
  const entityId = normalizeOptionalString(entity.entityId);

  if (!entityType || !entityId) {
    return [];
  }

  const prefix = buildCliPrefix(dbPath);
  const commands = [];

  // Always add the show command
  commands.push(buildShowCommand(prefix, entityType, entityId));

  // If roadmap, add work-point list
  if (entityType === 'roadmap') {
    commands.push(buildWorkPointListCommand(prefix, entityId));
  }

  // If goal, add roadmap list
  if (entityType === 'goal') {
    commands.push(buildRoadmapListCommand(prefix, entityId));
  }

  // Always add tags and validate commands
  commands.push(buildTagsCommand(prefix, entityType, entityId));
  commands.push(buildValidateCommand(prefix, entityType, entityId));

  return commands;
}

module.exports = {
  buildCopyableCliCommands,
};
