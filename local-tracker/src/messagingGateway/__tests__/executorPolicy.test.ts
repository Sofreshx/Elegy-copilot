import { evaluateExecutorPolicy, resolveExecutorRiskLevel } from '../workflows/executorPolicy';

describe('resolveExecutorRiskLevel', () => {
    it('classifies dev.implement as mutating', () => {
        expect(resolveExecutorRiskLevel('dev.implement')).toBe('mutating');
    });

    it('classifies git.merge-prs as destructive', () => {
        expect(resolveExecutorRiskLevel('git.merge-prs')).toBe('destructive');
    });

    it('keeps backward-compatible classifications for existing action names', () => {
        expect(resolveExecutorRiskLevel('create-resource')).toBe('mutating');
        expect(resolveExecutorRiskLevel('delete-resource')).toBe('destructive');
        expect(resolveExecutorRiskLevel('dev.research')).toBe('read-only');
    });
});

describe('evaluateExecutorPolicy', () => {
    it('blocks mutating dev.implement when dryRun is not set and override is absent', () => {
        const result = evaluateExecutorPolicy('dev.implement', { ticket: 'G-05-WU-03' }, {});

        expect(result.allowed).toBe(false);
        expect(result.riskLevel).toBe('mutating');
        expect(result.reason).toContain('requires dryRun=true');
    });

    it('allows mutating dev.implement when dryRun is true', () => {
        const result = evaluateExecutorPolicy('dev.implement', { dryRun: true }, {});

        expect(result).toEqual({
            allowed: true,
            riskLevel: 'mutating',
        });
    });

    it('allows mutating dev.implement when allowMutatingExecutors is true', () => {
        const result = evaluateExecutorPolicy('dev.implement', undefined, { allowMutatingExecutors: true });

        expect(result).toEqual({
            allowed: true,
            riskLevel: 'mutating',
        });
    });

    it('blocks destructive git.merge-prs by default when dryRun is not set', () => {
        const result = evaluateExecutorPolicy('git.merge-prs', { command: 'merge --ff-only' }, {});

        expect(result.allowed).toBe(false);
        expect(result.riskLevel).toBe('destructive');
        expect(result.reason).toContain('requires dryRun=true');
    });

    it('allows destructive git.merge-prs when allowDestructiveExecutors is true', () => {
        const result = evaluateExecutorPolicy('git.merge-prs', { command: 'merge --ff-only' }, {
            allowDestructiveExecutors: true,
        });

        expect(result).toEqual({
            allowed: true,
            riskLevel: 'destructive',
        });
    });
});
