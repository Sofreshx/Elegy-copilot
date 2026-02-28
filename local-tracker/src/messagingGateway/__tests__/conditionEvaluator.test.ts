import { evaluateStepCondition } from '../workflows/conditionEvaluator';
import { StepOutputStore } from '../workflows/stepOutputStore';

function withOutputs(outputs: Record<string, unknown>): StepOutputStore {
    const store = new StepOutputStore();
    for (const [stepId, output] of Object.entries(outputs)) {
        store.setStepOutput(stepId, output);
    }
    return store;
}

describe('evaluateStepCondition', () => {
    it('returns true for a valid condition with logical/comparison operators', () => {
        const store = withOutputs({
            A: { score: 12, active: true },
        });

        const result = evaluateStepCondition('A.score >= 10 && A.active == true', store);
        expect(result).toBe(true);
    });

    it('returns false when comparison does not match', () => {
        const store = withOutputs({
            A: { score: 5 },
        });

        const result = evaluateStepCondition('A.score > 10', store);
        expect(result).toBe(false);
    });

    it('supports regex matches operator', () => {
        const store = withOutputs({
            A: { branch: 'feature/g-04' },
        });

        const result = evaluateStepCondition('A.branch matches "^feature/[a-z0-9-]+$"', store);
        expect(result).toBe(true);
    });

    it('enforces max expression length', () => {
        const store = withOutputs({ A: { value: 1 } });
        const expression = `A.value == 1 && ${'x'.repeat(242)}`;

        expect(() => evaluateStepCondition(expression, store)).toThrow('Condition length exceeds max 256');
    });

    it('enforces max parentheses nesting depth of 2', () => {
        const store = withOutputs({ A: { value: 1 } });
        const expression = '(((A.value == 1)))';

        expect(() => evaluateStepCondition(expression, store)).toThrow('Parentheses nesting exceeds max depth 2');
    });

    it('rejects regex patterns longer than 100 chars', () => {
        const store = withOutputs({ A: { value: 'hello' } });
        const expression = `A.value matches "${'a'.repeat(101)}"`;

        expect(() => evaluateStepCondition(expression, store)).toThrow('Regex pattern length exceeds max 100');
    });

    it('rejects lookahead and lookbehind regex patterns', () => {
        const store = withOutputs({ A: { value: 'abc' } });

        expect(() => evaluateStepCondition('A.value matches "(?=a)abc"', store)).toThrow(
            'Regex lookahead/lookbehind is not allowed',
        );
        expect(() => evaluateStepCondition('A.value matches "(?<=a)b"', store)).toThrow(
            'Regex lookahead/lookbehind is not allowed',
        );
    });

    it('blocks dangerous path segments', () => {
        const store = withOutputs({ A: { safe: true } });

        expect(() => evaluateStepCondition('A.__proto__.polluted == null', store)).toThrow(
            'Dangerous path segment used in condition',
        );
    });

    it('throws on malformed expression', () => {
        const store = withOutputs({ A: { value: 1 } });

        expect(() => evaluateStepCondition('A.value ==', store)).toThrow('Unexpected token type: eof');
    });
});
