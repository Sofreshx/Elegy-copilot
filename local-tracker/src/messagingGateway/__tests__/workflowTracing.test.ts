import { getWorkflowTracer, isTracingEnabled, resetTracerCache } from '../workflows/workflowTracing';

describe('workflowTracing', () => {
    const originalEnv = process.env.OTEL_WORKFLOW_TRACING_ENABLED;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OTEL_WORKFLOW_TRACING_ENABLED;
        } else {
            process.env.OTEL_WORKFLOW_TRACING_ENABLED = originalEnv;
        }
        resetTracerCache();
    });

    describe('isTracingEnabled', () => {
        it('returns false when env var is not set', () => {
            delete process.env.OTEL_WORKFLOW_TRACING_ENABLED;
            expect(isTracingEnabled()).toBe(false);
        });

        it('returns false when env var is "false"', () => {
            process.env.OTEL_WORKFLOW_TRACING_ENABLED = 'false';
            expect(isTracingEnabled()).toBe(false);
        });

        it('returns false when env var is empty', () => {
            process.env.OTEL_WORKFLOW_TRACING_ENABLED = '';
            expect(isTracingEnabled()).toBe(false);
        });

        it('returns true when env var is "true"', () => {
            process.env.OTEL_WORKFLOW_TRACING_ENABLED = 'true';
            expect(isTracingEnabled()).toBe(true);
        });
    });

    describe('NoopTracer (disabled mode)', () => {
        beforeEach(() => {
            delete process.env.OTEL_WORKFLOW_TRACING_ENABLED;
            resetTracerCache();
        });

        it('returns a tracer that produces noop spans', () => {
            const tracer = getWorkflowTracer();
            const span = tracer.startSpan('test-span');
            // Should not throw
            span.setAttribute('key', 'value');
            span.setStatus('ok');
            span.end();
        });

        it('getActiveTraceId returns undefined in noop mode', () => {
            const tracer = getWorkflowTracer();
            expect(tracer.getActiveTraceId()).toBeUndefined();
        });

        it('startSpan with attributes returns noop span', () => {
            const tracer = getWorkflowTracer();
            const span = tracer.startSpan('test', { 'attr.num': 42, 'attr.bool': true });
            span.setStatus('error', 'test error');
            span.end();
            // No assertions needed — just verifying no errors thrown
        });
    });

    describe('tracer caching', () => {
        it('returns the same tracer instance on subsequent calls', () => {
            delete process.env.OTEL_WORKFLOW_TRACING_ENABLED;
            resetTracerCache();
            const tracer1 = getWorkflowTracer();
            const tracer2 = getWorkflowTracer();
            expect(tracer1).toBe(tracer2);
        });

        it('resetTracerCache forces a new tracer instance', () => {
            delete process.env.OTEL_WORKFLOW_TRACING_ENABLED;
            resetTracerCache();
            const tracer1 = getWorkflowTracer();
            resetTracerCache();
            const tracer2 = getWorkflowTracer();
            // Both are NoopTracer but different instances
            expect(tracer1).not.toBe(tracer2);
        });
    });
});
