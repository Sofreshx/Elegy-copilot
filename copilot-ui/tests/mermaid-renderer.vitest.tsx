import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MermaidViewer from '../ui/src/tabs/Planning/MermaidViewer';
import type { PlanningDiagram } from '../ui/src/lib/types';

const { mockInitialize, mockRender } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockRender: vi.fn(async (_id: string, source: string) => {
  if (source.includes('THROW_ERROR')) {
    throw new Error('Parse error: invalid Mermaid syntax');
  }

  if (source.includes('SCRIPT_INJECTION')) {
    return {
      svg: '<svg><script>alert(1)</script><text>safe</text></svg>',
    };
  }

  if (source.includes('ONERROR_INJECTION')) {
    return {
      svg: '<svg><image href="x" onerror="alert(1)" /><text>safe</text></svg>',
    };
  }

  if (source.includes('JS_URI_INJECTION')) {
    return {
      svg: '<svg><a href="javascript:alert(1)"><text>bad-link</text></a><text>safe</text></svg>',
    };
  }

  if (source.includes('FOREIGN_OBJECT_INJECTION')) {
    return {
      svg: '<svg><foreignObject><div onclick="alert(1)">bad</div></foreignObject><text>safe</text></svg>',
    };
  }

  if (source.includes('MIXED_INJECTION')) {
    return {
      svg: '<svg><script>alert(1)</script><a href="javascript:alert(1)">x</a><image onerror="alert(2)" /><text>safe</text></svg>',
    };
  }

  return {
    svg: '<svg><text>valid diagram</text></svg>',
  };
  }),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

function makeDiagram(content: string, id = 'diagram-1'): PlanningDiagram {
  return {
    id,
    type: 'sequence',
    title: 'Diagram',
    content,
    format: 'mermaid',
    createdAt: '2026-03-01T00:00:00.000Z',
  };
}

async function waitForSvgContainer(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByTestId('mermaid-viewer')).toBeInTheDocument();
  });

  const output = document.querySelector('.mermaid-viewer-output') as HTMLElement | null;
  if (!output) {
    throw new Error('Expected .mermaid-viewer-output');
  }
  return output;
}

describe('MermaidViewer', () => {
  it('renders valid diagrams as sanitized SVG output', async () => {
    render(<MermaidViewer diagram={makeDiagram('graph TD; A-->B')} />);

    const output = await waitForSvgContainer();
    expect(output.innerHTML).toContain('<svg');
    expect(output.innerHTML).toContain('valid diagram');
  });

  it('strips script injection from rendered SVG', async () => {
    render(<MermaidViewer diagram={makeDiagram('SCRIPT_INJECTION')} />);

    const output = await waitForSvgContainer();
    expect(output.innerHTML.toLowerCase()).not.toContain('<script');
    expect(output.innerHTML).toContain('safe');
  });

  it('strips onerror handlers from rendered SVG', async () => {
    render(<MermaidViewer diagram={makeDiagram('ONERROR_INJECTION')} />);

    const output = await waitForSvgContainer();
    expect(output.innerHTML.toLowerCase()).not.toContain('onerror=');
    expect(output.innerHTML).toContain('safe');
  });

  it('strips javascript URI links from rendered SVG', async () => {
    render(<MermaidViewer diagram={makeDiagram('JS_URI_INJECTION')} />);

    const output = await waitForSvgContainer();
    expect(output.innerHTML.toLowerCase()).not.toContain('javascript:alert');
    expect(output.innerHTML).toContain('safe');
  });

  it('strips foreignObject payloads from rendered SVG', async () => {
    render(<MermaidViewer diagram={makeDiagram('FOREIGN_OBJECT_INJECTION')} />);

    const output = await waitForSvgContainer();
    expect(output.innerHTML.toLowerCase()).not.toContain('foreignobject');
    expect(output.innerHTML).toContain('safe');
  });

  it('strips mixed XSS vectors from one payload', async () => {
    render(<MermaidViewer diagram={makeDiagram('MIXED_INJECTION')} />);

    const output = await waitForSvgContainer();
    const html = output.innerHTML.toLowerCase();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror=');
    expect(output.innerHTML).toContain('safe');
  });

  it('shows graceful error state when Mermaid rendering fails', async () => {
    render(<MermaidViewer diagram={makeDiagram('THROW_ERROR', 'broken-diagram')} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/Diagram render failed:/)).toBeInTheDocument();
    expect(screen.getByText('THROW_ERROR')).toBeInTheDocument();
  });
});
