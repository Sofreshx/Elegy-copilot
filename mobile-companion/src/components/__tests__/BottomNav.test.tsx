import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BottomNav from '../BottomNav';

describe('BottomNav', () => {
  it('renders all navigation labels', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNav />
      </MemoryRouter>
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Ideas')).toBeInTheDocument();
    expect(screen.getByText('AI Chat')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the active route', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <BottomNav />
      </MemoryRouter>
    );

    const links = screen.getAllByRole('link', { name: 'Ideas' });
    expect(links.length).toBeGreaterThan(0);

    const link = links[0];
    if (!link) {
      throw new Error('Ideas link not found');
    }

    await user.click(link);

    await waitFor(() => {
      expect(link).toHaveClass('active');
    });
  });
});
