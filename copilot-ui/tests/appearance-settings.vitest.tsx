import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('AppearanceSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('offers system, light, and dark theme choices and persists the selection', async () => {
    const { default: AppearanceSettings } = await import('../ui/src/views/Settings/AppearanceSettings');
    render(<AppearanceSettings />);

    const select = screen.getByTestId('theme-preference');
    expect(select).toHaveValue('system');
    expect(screen.getByRole('option', { name: 'Use system setting' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dark' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'dark' } });
    expect(select).toHaveValue('dark');
    expect(localStorage.getItem('elegy-copilot-theme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
