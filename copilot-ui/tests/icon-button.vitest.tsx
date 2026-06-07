import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IconButton from '../ui/src/components/IconButton';

describe('IconButton', () => {
  it('renders a button with aria-label', () => {
    render(<IconButton icon="settings" label="Settings" />);
    const btn = screen.getByRole('button', { name: 'Settings' });
    expect(btn).toBeInTheDocument();
  });

  it('renders SVG icon inside', () => {
    const { container } = render(<IconButton icon="settings" label="Settings" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<IconButton icon="settings" label="Settings" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<IconButton icon="settings" label="Settings" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies active class when active', () => {
    render(<IconButton icon="settings" label="Settings" active />);
    const btn = screen.getByRole('button', { name: 'Settings' });
    expect(btn.className).toContain('icon-button-active');
  });

  it('uses title as aria-label fallback', () => {
    render(<IconButton icon="settings" label="Settings" title="Go to Settings" />);
    const btn = screen.getByRole('button', { name: 'Settings' });
    expect(btn).toHaveAttribute('title', 'Go to Settings');
  });

  it('sets default testId', () => {
    render(<IconButton icon="settings" label="Settings" />);
    expect(screen.getByTestId('icon-button')).toBeInTheDocument();
  });

  it('uses custom testId', () => {
    render(<IconButton icon="settings" label="Settings" testId="custom-btn" />);
    expect(screen.getByTestId('custom-btn')).toBeInTheDocument();
  });
});
