import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatGatewayStateSummary } from '../ui/src/tabs/Gateway/gatewayStore';
import SessionDetail from '../ui/src/tabs/Sessions/SessionDetail';
import SessionItem from '../ui/src/tabs/Sessions/SessionItem';

describe('session readability diagnostics', () => {
  it('renders SessionItem with explicit reason copy', () => {
    render(
      <ul>
        <SessionItem
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

describe('gateway readability formatting', () => {
  it('formats gateway summary with readable labels and reason detail', () => {
    const summary = formatGatewayStateSummary(
      {
        ready: false,
        status: 'not_ready',
        error: {
          reason: 'planning_persistence_not_ready',
          statusCode: 0,
        },
      },
      'unknown'
    );

    expect(summary).toContain('Not Ready');
    expect(summary).toContain('Not ready');
    expect(summary).toContain('Planning Persistence Not Ready');
    expect(summary).toContain('HTTP 0');
  });
});
