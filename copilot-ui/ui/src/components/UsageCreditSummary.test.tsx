import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import UsageCreditSummary from './UsageCreditSummary';

describe('UsageCreditSummary', () => {
  it('renders loading state', () => {
    const { getByTestId, getByText } = render(
      <UsageCreditSummary status="loading" testId="usage-test" />
    );
    expect(getByTestId('usage-test')).toBeDefined();
    expect(getByText('Loading usage data…')).toBeDefined();
  });

  it('renders unavailable state with error message', () => {
    const { getByText } = render(
      <UsageCreditSummary status="unavailable" errorMessage="API error" testId="usage-test" />
    );
    expect(getByText('API error')).toBeDefined();
  });

  it('renders unavailable state with default message', () => {
    const { getByText } = render(
      <UsageCreditSummary status="unavailable" testId="usage-test" />
    );
    expect(getByText('Usage data is unavailable.')).toBeDefined();
  });

  it('returns null for empty status', () => {
    const { container } = render(
      <UsageCreditSummary status="empty" testId="usage-test" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null for empty metrics array', () => {
    const { container } = render(
      <UsageCreditSummary status="available" metrics={[]} testId="usage-test" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders metric with current value only', () => {
    const { getByText } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 5000 }]}
        testId="usage-test"
      />
    );
    expect(getByText('Tokens')).toBeDefined();
    // The number format depends on locale (toLocaleString()), use regex
    expect(getByText(/5[,\s\u00a0]000/)).toBeDefined();
  });

  it('renders metric with current and limit', () => {
    const { getByText } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 5000, limit: 10000 }]}
        testId="usage-test"
      />
    );
    expect(getByText(/5[,\s\u00a0]000/)).toBeDefined();
    expect(getByText(/10[,\s\u00a0]000/)).toBeDefined();
  });

  it('renders metric with remaining value', () => {
    const { container } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 5000, limit: 10000, remaining: 5000 }]}
        testId="usage-test"
      />
    );
    const remainingEl = container.querySelector('.usage-credit-metric-remaining');
    expect(remainingEl).toBeDefined();
    expect(remainingEl!.textContent).toMatch(/5[,\s\u00a0]000/);
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 75, limit: 100, progress: 0.75 }]}
        testId="usage-test"
      />
    );
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).toBeDefined();
    expect(progressBar!.getAttribute('aria-valuenow')).toBe('75');
    expect(progressBar!.getAttribute('aria-valuemin')).toBe('0');
    expect(progressBar!.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps progress to 0-100 range', () => {
    const { container } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 150, limit: 100, progress: -0.5 }]}
        testId="usage-test"
      />
    );
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar!.getAttribute('aria-valuenow')).toBe('0'); // clamped from -50
  });

  it('renders status class for exhausted metric', () => {
    const { container } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 100, limit: 100, status: 'exhausted' }]}
        testId="usage-test"
      />
    );
    const metric = container.querySelector('.usage-credit-metric-exhausted');
    expect(metric).toBeDefined();
  });

  it('renders timestamp when provided', () => {
    const { getByText } = render(
      <UsageCreditSummary
        status="available"
        metrics={[{ label: 'Tokens', current: 5000, updatedAt: '2025-06-22T12:00:00Z' }]}
        testId="usage-test"
      />
    );
    expect(getByText(/Updated/)).toBeDefined();
  });

  it('renders provider label', () => {
    const { getByText } = render(
      <UsageCreditSummary
        status="available"
        providerLabel="OpenCode Go"
        metrics={[{ label: 'Tokens', current: 5000 }]}
        testId="usage-test"
      />
    );
    expect(getByText('OpenCode Go')).toBeDefined();
  });
});
