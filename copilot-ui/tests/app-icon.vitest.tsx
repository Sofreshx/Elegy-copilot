import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AppIcon from '../ui/src/components/AppIcon';

describe('AppIcon', () => {
  it('renders an SVG with correct viewBox attributes', () => {
    const { container } = render(<AppIcon name="settings" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a path element inside the SVG', () => {
    const { container } = render(<AppIcon name="settings" />);
    const path = container.querySelector('svg path');
    expect(path).toBeInTheDocument();
    expect(path).toHaveAttribute('d');
  });

  it('uses default size 20 when no size is provided', () => {
    const { container } = render(<AppIcon name="settings" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('returns null for unknown icon name', () => {
    const { container } = render(<AppIcon name={'nonexistent' as any} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  it('applies className to SVG', () => {
    const { container } = render(<AppIcon name="settings" className="test-class" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('test-class');
  });

  // Test key icon names render valid paths
  const keyIcons = [
    'chevron-left', 'chevron-right', 'chevron-down', 'chevron-up',
    'arrow-left', 'arrow-right', 'menu', 'folder-open', 'folder',
    'file-text', 'git-branch', 'copy', 'close', 'minimize',
    'maximize', 'restore', 'info', 'play', 'pause', 'star',
    'external-link', 'repo', 'focus', 'tree', 'layout',
    'user', 'help-circle', 'diamond', 'hexagon', 'squared-plus',
    'success', 'error',
  ];

  for (const name of keyIcons) {
    it(`renders icon "${name}" with valid path`, () => {
      const { container } = render(<AppIcon name={name as any} />);
      const path = container.querySelector('svg path');
      expect(path).toBeInTheDocument();
      const d = path!.getAttribute('d');
      expect(d).toBeTruthy();
      expect(d!.length).toBeGreaterThanOrEqual(5);
    });
  }
});
