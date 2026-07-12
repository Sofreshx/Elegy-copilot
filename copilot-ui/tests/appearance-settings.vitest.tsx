import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('AppearanceSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows Ember Foundry as the only supported theme', async () => {
    const { default: AppearanceSettings } = await import('../ui/src/views/Settings/AppearanceSettings');
    render(<AppearanceSettings />);

    expect(screen.getByTestId('theme-preference')).toHaveTextContent('Ember Foundry');
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
