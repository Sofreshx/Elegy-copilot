import { describe, expect, it } from 'vitest';
import { assetPath } from '../ui/src/lib/assetPath';

describe('assetPath', () => {
  it('does not emit a double slash for root-based public assets', () => {
    expect(assetPath('elegy-copilot-icon.png')).toBe('/elegy-copilot-icon.png');
  });
});
