// Feature-flagged tracer module
// When OTEL_WORKFLOW_TRACING_ENABLED is not 'true', returns noop spans

export interface TracingSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: 'ok' | 'error', message?: string): void;
  end(): void;
}

export interface WorkflowTracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): TracingSpan;
  getActiveTraceId(): string | undefined;
}

class NoopSpan implements TracingSpan {
  setAttribute(): void {}
  setStatus(): void {}
  end(): void {}
}

class NoopTracer implements WorkflowTracer {
  startSpan(): TracingSpan { return new NoopSpan(); }
  getActiveTraceId(): undefined { return undefined; }
}

let cachedTracer: WorkflowTracer | null = null;

export function isTracingEnabled(): boolean {
  return process.env.OTEL_WORKFLOW_TRACING_ENABLED === 'true';
}

export function getWorkflowTracer(): WorkflowTracer {
  if (cachedTracer) return cachedTracer;

  if (!isTracingEnabled()) {
    cachedTracer = new NoopTracer();
    return cachedTracer;
  }

  // Dynamic import to avoid requiring OTel when disabled
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const api = require('@opentelemetry/api');
    const tracer = api.trace.getTracer('workflow-engine', '1.0.0');

    cachedTracer = {
      startSpan(name: string, attributes?: Record<string, string | number | boolean>): TracingSpan {
        const span = tracer.startSpan(name);
        if (attributes) {
          for (const [k, v] of Object.entries(attributes)) {
            span.setAttribute(k, v);
          }
        }
        return {
          setAttribute(key: string, value: string | number | boolean) { span.setAttribute(key, value); },
          setStatus(code: 'ok' | 'error', message?: string) {
            span.setStatus({ code: code === 'ok' ? api.SpanStatusCode.OK : api.SpanStatusCode.ERROR, message });
          },
          end() { span.end(); },
        };
      },
      getActiveTraceId(): string | undefined {
        const activeSpan = api.trace.getActiveSpan();
        return activeSpan?.spanContext()?.traceId;
      },
    };
    return cachedTracer;
  } catch {
    cachedTracer = new NoopTracer();
    return cachedTracer;
  }
}

export function resetTracerCache(): void {
  cachedTracer = null;
}
