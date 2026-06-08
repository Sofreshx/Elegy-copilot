/**
 * Shared profile normalization logic.
 * Used by both copilot-ui/lib/opencodeConfig.js and scripts/.
 */

export function normalizeProfile(profile, profileId) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }

  const normalized = { ...profile };

  if (!normalized.roleModels || typeof normalized.roleModels !== 'object') {
    normalized.roleModels = {
      exploration: typeof normalized.small === 'string' ? normalized.small : '',
      implementation: typeof normalized.small === 'string' ? normalized.small : '',
      planning: typeof normalized.big === 'string' ? normalized.big : '',
      review: typeof normalized.review === 'string' ? normalized.review : '',
      research: typeof normalized.big === 'string' ? normalized.big : '',
    };
  }

  if (!normalized.label) {
    normalized.label = typeof profileId === 'string' ? profileId : 'Unknown Profile';
  }
  if (!normalized.description) {
    normalized.description = '';
  }
  if (!Array.isArray(normalized.tags)) {
    normalized.tags = [];
  }

  return normalized;
}
