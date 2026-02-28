import { StepOutputStore } from './stepOutputStore';

const MAX_EXPRESSION_LENGTH = 256;
const MAX_PATTERN_LENGTH = 100;
const MAX_PAREN_NESTING_DEPTH = 2;
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const LOOKAROUND_PATTERN = /\(\?<?[=!]/;

type TokenType =
    | 'and'
    | 'or'
    | 'not'
    | 'eq'
    | 'neq'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'matches'
    | 'lparen'
    | 'rparen'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'reference'
    | 'eof';

interface Token {
    type: TokenType;
    value?: string | number | boolean | null;
}

type ExpressionNode =
    | { type: 'literal'; value: string | number | boolean | null }
    | { type: 'reference'; path: string }
    | { type: 'unary'; operator: 'not'; operand: ExpressionNode }
    | {
          type: 'binary';
          operator: 'and' | 'or' | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'matches';
          left: ExpressionNode;
          right: ExpressionNode;
      };

export class ConditionEvaluationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConditionEvaluationError';
    }
}

function isDelimiter(char: string | undefined): boolean {
    if (!char) return true;
    return /\s|[()&|!=<>"']/.test(char);
}

function tokenize(expression: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    while (index < expression.length) {
        const current = expression[index];

        if (/\s/.test(current)) {
            index += 1;
            continue;
        }

        const twoChars = expression.slice(index, index + 2);
        if (twoChars === '&&') {
            tokens.push({ type: 'and' });
            index += 2;
            continue;
        }

        if (twoChars === '||') {
            tokens.push({ type: 'or' });
            index += 2;
            continue;
        }

        if (twoChars === '==') {
            tokens.push({ type: 'eq' });
            index += 2;
            continue;
        }

        if (twoChars === '!=') {
            tokens.push({ type: 'neq' });
            index += 2;
            continue;
        }

        if (twoChars === '>=') {
            tokens.push({ type: 'gte' });
            index += 2;
            continue;
        }

        if (twoChars === '<=') {
            tokens.push({ type: 'lte' });
            index += 2;
            continue;
        }

        if (current === '!') {
            tokens.push({ type: 'not' });
            index += 1;
            continue;
        }

        if (current === '>') {
            tokens.push({ type: 'gt' });
            index += 1;
            continue;
        }

        if (current === '<') {
            tokens.push({ type: 'lt' });
            index += 1;
            continue;
        }

        if (current === '(') {
            tokens.push({ type: 'lparen' });
            index += 1;
            continue;
        }

        if (current === ')') {
            tokens.push({ type: 'rparen' });
            index += 1;
            continue;
        }

        if (current === '"' || current === "'") {
            const quote = current;
            index += 1;
            let value = '';

            while (index < expression.length && expression[index] !== quote) {
                const char = expression[index];
                if (char === '\\') {
                    const escaped = expression[index + 1];
                    if (!escaped) {
                        throw new ConditionEvaluationError('Unterminated escape sequence in string literal');
                    }

                    if (escaped === 'n') value += '\n';
                    else if (escaped === 'r') value += '\r';
                    else if (escaped === 't') value += '\t';
                    else value += escaped;

                    index += 2;
                    continue;
                }

                value += char;
                index += 1;
            }

            if (index >= expression.length || expression[index] !== quote) {
                throw new ConditionEvaluationError('Unterminated string literal');
            }

            index += 1;
            tokens.push({ type: 'string', value });
            continue;
        }

        let end = index;
        while (end < expression.length && !isDelimiter(expression[end])) {
            end += 1;
        }

        const rawWord = expression.slice(index, end);
        index = end;

        if (rawWord === 'true') {
            tokens.push({ type: 'boolean', value: true });
            continue;
        }

        if (rawWord === 'false') {
            tokens.push({ type: 'boolean', value: false });
            continue;
        }

        if (rawWord === 'null') {
            tokens.push({ type: 'null', value: null });
            continue;
        }

        if (rawWord === 'matches') {
            tokens.push({ type: 'matches' });
            continue;
        }

        if (/^\d+(?:\.\d+)?$/.test(rawWord)) {
            tokens.push({ type: 'number', value: Number(rawWord) });
            continue;
        }

        if (/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(rawWord)) {
            tokens.push({ type: 'reference', value: rawWord });
            continue;
        }

        throw new ConditionEvaluationError(`Unexpected token: ${rawWord}`);
    }

    tokens.push({ type: 'eof' });
    return tokens;
}

class ConditionParser {
    private readonly tokens: Token[];
    private index = 0;
    private depth = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): ExpressionNode {
        const node = this.parseOr();
        this.expect('eof', 'Unexpected trailing tokens');
        return node;
    }

    private parseOr(): ExpressionNode {
        let left = this.parseAnd();
        while (this.match('or')) {
            const right = this.parseAnd();
            left = { type: 'binary', operator: 'or', left, right };
        }
        return left;
    }

    private parseAnd(): ExpressionNode {
        let left = this.parseComparison();
        while (this.match('and')) {
            const right = this.parseComparison();
            left = { type: 'binary', operator: 'and', left, right };
        }
        return left;
    }

    private parseComparison(): ExpressionNode {
        let left = this.parseUnary();

        while (true) {
            const operatorType = this.peek().type;
            if (!this.isComparisonOperator(operatorType)) {
                break;
            }

            this.consume();
            const right = this.parseUnary();
            left = {
                type: 'binary',
                operator: operatorType,
                left,
                right,
            };
        }

        return left;
    }

    private parseUnary(): ExpressionNode {
        if (this.match('not')) {
            return {
                type: 'unary',
                operator: 'not',
                operand: this.parseUnary(),
            };
        }

        return this.parsePrimary();
    }

    private parsePrimary(): ExpressionNode {
        const token = this.peek();

        if (token.type === 'lparen') {
            this.consume();
            if (this.depth + 1 > MAX_PAREN_NESTING_DEPTH) {
                throw new ConditionEvaluationError(
                    `Parentheses nesting exceeds max depth ${MAX_PAREN_NESTING_DEPTH}`,
                );
            }

            this.depth += 1;
            const expression = this.parseOr();
            this.expect('rparen', 'Expected closing parenthesis');
            this.depth -= 1;
            return expression;
        }

        if (token.type === 'string' || token.type === 'number' || token.type === 'boolean' || token.type === 'null') {
            this.consume();
            return { type: 'literal', value: token.value ?? null };
        }

        if (token.type === 'reference') {
            this.consume();
            return { type: 'reference', path: String(token.value) };
        }

        throw new ConditionEvaluationError(`Unexpected token type: ${token.type}`);
    }

    private isComparisonOperator(type: TokenType): type is 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'matches' {
        return type === 'eq' || type === 'neq' || type === 'gt' || type === 'lt' || type === 'gte' || type === 'lte' || type === 'matches';
    }

    private match(type: TokenType): boolean {
        if (this.peek().type === type) {
            this.consume();
            return true;
        }

        return false;
    }

    private expect(type: TokenType, message: string): void {
        if (this.peek().type !== type) {
            throw new ConditionEvaluationError(message);
        }
        this.consume();
    }

    private consume(): Token {
        const token = this.tokens[this.index];
        this.index += 1;
        return token;
    }

    private peek(): Token {
        return this.tokens[this.index] ?? { type: 'eof' };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveReference(path: string, outputStore: StepOutputStore): unknown {
    const segments = path.split('.').filter(Boolean);
    if (segments.length < 2) {
        throw new ConditionEvaluationError(`Invalid reference path: ${path}`);
    }

    if (segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))) {
        throw new ConditionEvaluationError(`Dangerous path segment used in condition: ${path}`);
    }

    const [stepId, ...fieldPath] = segments;
    let current: unknown = outputStore.getStepOutput(stepId);

    for (const segment of fieldPath) {
        if (Array.isArray(current)) {
            if (!/^\d+$/.test(segment)) {
                return undefined;
            }
            current = current[Number(segment)];
            continue;
        }

        if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return undefined;
        }

        current = current[segment];
    }

    return current;
}

function toBoolean(value: unknown): boolean {
    return Boolean(value);
}

function evaluateComparison(operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'matches', left: unknown, right: unknown): boolean {
    if (operator === 'eq') return Object.is(left, right);
    if (operator === 'neq') return !Object.is(left, right);

    if (operator === 'matches') {
        if (typeof right !== 'string') {
            return false;
        }

        if (right.length > MAX_PATTERN_LENGTH) {
            throw new ConditionEvaluationError(`Regex pattern length exceeds max ${MAX_PATTERN_LENGTH}`);
        }

        if (LOOKAROUND_PATTERN.test(right)) {
            throw new ConditionEvaluationError('Regex lookahead/lookbehind is not allowed');
        }

        const regex = new RegExp(right);
        const target = left == null ? '' : String(left);
        return regex.test(target);
    }

    if (typeof left === 'number' && typeof right === 'number') {
        if (operator === 'gt') return left > right;
        if (operator === 'lt') return left < right;
        if (operator === 'gte') return left >= right;
        return left <= right;
    }

    if (typeof left === 'string' && typeof right === 'string') {
        if (operator === 'gt') return left > right;
        if (operator === 'lt') return left < right;
        if (operator === 'gte') return left >= right;
        return left <= right;
    }

    return false;
}

function evaluateNode(node: ExpressionNode, outputStore: StepOutputStore): unknown {
    if (node.type === 'literal') {
        return node.value;
    }

    if (node.type === 'reference') {
        return resolveReference(node.path, outputStore);
    }

    if (node.type === 'unary') {
        const value = evaluateNode(node.operand, outputStore);
        return !toBoolean(value);
    }

    if (node.operator === 'and') {
        const left = evaluateNode(node.left, outputStore);
        if (!toBoolean(left)) {
            return false;
        }

        return toBoolean(evaluateNode(node.right, outputStore));
    }

    if (node.operator === 'or') {
        const left = evaluateNode(node.left, outputStore);
        if (toBoolean(left)) {
            return true;
        }

        return toBoolean(evaluateNode(node.right, outputStore));
    }

    const left = evaluateNode(node.left, outputStore);
    const right = evaluateNode(node.right, outputStore);
    return evaluateComparison(node.operator, left, right);
}

export function evaluateStepCondition(expression: string, outputStore: StepOutputStore): boolean {
    if (expression.length > MAX_EXPRESSION_LENGTH) {
        throw new ConditionEvaluationError(`Condition length exceeds max ${MAX_EXPRESSION_LENGTH}`);
    }

    const trimmed = expression.trim();
    if (trimmed.length === 0) {
        throw new ConditionEvaluationError('Condition cannot be empty');
    }

    const tokens = tokenize(trimmed);
    const parser = new ConditionParser(tokens);
    const ast = parser.parse();
    return toBoolean(evaluateNode(ast, outputStore));
}
