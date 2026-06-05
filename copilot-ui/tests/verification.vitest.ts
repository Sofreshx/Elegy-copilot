import { describe, expect, it } from 'vitest';
import { computeVerificationState, verificationLabel, verificationTone } from '../ui/src/views/Repositories/verification';

describe('computeVerificationState', () => {
  it('returns missing when no check has been run', () => {
    expect(computeVerificationState({
      hasCheckRun: false,
      checkPassed: false,
      branch: 'main',
      headAtRun: null,
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'unavailable',
    })).toBe('missing');
  });

  it('returns verified when checks pass and CI is unavailable', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'unavailable',
    })).toBe('verified');
  });

  it('returns verified when checks pass and CI passed', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'passed',
    })).toBe('verified');
  });

  it('returns partial when checks pass but CI is pending', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'pending',
    })).toBe('partial');
  });

  it('returns partial when checks pass but CI is not-found', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'not-found',
    })).toBe('partial');
  });

  it('returns failed when checks fail', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: false,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'unavailable',
    })).toBe('failed');
  });

  it('returns failed when checks pass but CI failed', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'failed',
    })).toBe('failed');
  });

  it('returns stale when head changed since last run', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'def456',
      changeCountAtRun: 0,
      currentChangeCount: 0,
      ciStatus: 'unavailable',
    })).toBe('stale');
  });

  it('returns stale when change count changed since last run', () => {
    expect(computeVerificationState({
      hasCheckRun: true,
      checkPassed: true,
      branch: 'main',
      headAtRun: 'abc123',
      currentHead: 'abc123',
      changeCountAtRun: 2,
      currentChangeCount: 5,
      ciStatus: 'unavailable',
    })).toBe('stale');
  });
});

describe('verificationLabel', () => {
  it('returns correct labels for all states', () => {
    expect(verificationLabel('verified')).toBe('Checks passed');
    expect(verificationLabel('partial')).toBe('Local checks passed, CI pending');
    expect(verificationLabel('failed')).toBe('Checks failed');
    expect(verificationLabel('stale')).toBe('Checks stale');
    expect(verificationLabel('missing')).toBe('Checks not run');
  });
});

describe('verificationTone', () => {
  it('returns correct tones for all states', () => {
    expect(verificationTone('verified')).toBe('success');
    expect(verificationTone('partial')).toBe('brand');
    expect(verificationTone('failed')).toBe('danger');
    expect(verificationTone('stale')).toBe('neutral');
    expect(verificationTone('missing')).toBe('neutral');
  });
});
