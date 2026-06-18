import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SessionDetail from '../ui/src/tabs/Sessions/SessionDetail';
import SessionItem from '../ui/src/tabs/Sessions/SessionItem';

describe('session readability diagnostics', () => {
  it('renders SessionItem with explicit reason copy', () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <SessionItem
          onSelect={onSelect}
          selected={false}
          session={{
            id: 'session-1',
            source: 'cli',
            status: 'idle',
            reconciliation: {
              reason: 'artifact_only',
            },
          }}
        />
      </ul>
    );

    expect(screen.getByText('session-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select session session-1/i }));
    expect(onSelect).toHaveBeenCalledWith('session-1');
    expect(screen.queryByRole('button', { name: /inspect/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show details/i }));
    expect(screen.getByText(/Why:/)).toBeInTheDocument();
    expect(screen.getByText(/persisted artifacts only/i)).toBeInTheDocument();
  });

  it('renders SessionDetail with status and reason fields', () => {
    render(
      <SessionDetail
        session={{
          id: 'session-2',
          source: 'sandbox',
          status: 'inactive',
          reconciliation: {
            reason: 'runtime_only',
          },
        }}
      />
    );

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText(/Runtime Only/i)).toBeInTheDocument();
  });
});


