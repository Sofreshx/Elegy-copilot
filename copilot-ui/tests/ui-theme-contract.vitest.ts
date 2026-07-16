import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function contrastRatio(hexA: string, hexB: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace('#', '');
    const normalized = value.length === 3 ? [...value].map((part) => part + part).join('') : value;
    const channels = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('UI theme contract', () => {
  it('uses theme tokens for launcher surfaces instead of dark overlays', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'ui/src/app.css'), 'utf8');
    const menu = css.match(/\.workspace-launch-menu\s*\{([\s\S]*?)\}/)?.[1] || '';
    expect(menu).toContain('background: var(--color-surface-1)');
    expect(menu).toContain('border: 1px solid var(--color-border-200)');
    expect(menu).not.toContain('rgba(17, 20, 24');
  });

  it('defines the Graphite surface and semantic status colors', () => {
    const css = readFileSync(path.resolve(process.cwd(), 'ui/src/styles/tokens.css'), 'utf8');
    expect(css).toContain(':root[data-theme="graphite"]');
    expect(css).not.toContain(':root[data-theme="ember"]');
    expect(css).not.toContain(':root[data-theme="light"]');
    expect(css).not.toContain('#78b8b0');
    const warning = css.match(/--color-warning-600:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
    const success = css.match(/--color-success-500:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
    expect(warning).toBeTruthy();
    expect(success).toBeTruthy();
    expect(contrastRatio(warning!, '#1d2124')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(success!, '#1d2124')).toBeGreaterThanOrEqual(4.5);
  });
});
