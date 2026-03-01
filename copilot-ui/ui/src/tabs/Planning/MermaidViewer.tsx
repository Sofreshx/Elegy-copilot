import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import type { PlanningDiagram } from '../../lib/types';

interface MermaidViewerProps {
  diagram: PlanningDiagram | null;
}

let mermaidInitialized = false;

function ensureMermaid(): void {
  if (mermaidInitialized) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
  });

  mermaidInitialized = true;
}

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: {
      svg: true,
      svgFilters: true,
    },
  });
}

export default function MermaidViewer({ diagram }: MermaidViewerProps) {
  const [renderedSvg, setRenderedSvg] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      if (!diagram || !diagram.content.trim()) {
        setRenderedSvg('');
        setRenderError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setRenderError(null);

      try {
        ensureMermaid();
        const renderId = `planning-diagram-${diagram.id}-${Date.now()}`;
        const result = await mermaid.render(renderId, diagram.content);

        if (cancelled) {
          return;
        }

        const safeSvg = sanitizeSvg(result.svg || '');
        setRenderedSvg(safeSvg);
        setRenderError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error || 'Unable to render diagram');
        setRenderedSvg('');
        setRenderError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagram?.id, diagram?.content]);

  if (!diagram) {
    return <p className="state-message">Select a diagram to render.</p>;
  }

  if (!diagram.content.trim()) {
    return <p className="state-message">Selected diagram has no content.</p>;
  }

  if (loading) {
    return <p className="state-message">Rendering diagram...</p>;
  }

  if (renderError) {
    return (
      <div>
        <p className="planning-error" role="alert">
          Diagram render failed: {renderError}
        </p>
        <pre className="code-block">{diagram.content}</pre>
      </div>
    );
  }

  return (
    <div className="mermaid-viewer" data-testid="mermaid-viewer">
      <div className="mermaid-viewer-output" dangerouslySetInnerHTML={{ __html: renderedSvg }} />
    </div>
  );
}
