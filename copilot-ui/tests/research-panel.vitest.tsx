import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResearchNotesPanel from '../ui/src/tabs/Planning/ResearchNotesPanel';
import type { PlanningResearchNote } from '../ui/src/lib/types';

function makeNote(overrides: Partial<PlanningResearchNote>): PlanningResearchNote {
  return {
    id: overrides.id ?? 'note-1',
    phase: overrides.phase ?? 'research',
    title: overrides.title ?? 'Default title',
    content: overrides.content ?? 'Default content',
    createdAt: overrides.createdAt ?? '2026-03-01T00:00:00.000Z',
    sources: overrides.sources,
    source: overrides.source,
    summary: overrides.summary,
    updatedAt: overrides.updatedAt,
  };
}

function renderPanel(notes: PlanningResearchNote[]) {
  const onRefresh = vi.fn();
  const onSave = vi.fn();
  const onDelete = vi.fn();

  render(
    <ResearchNotesPanel
      deleting={false}
      error={null}
      loading={false}
      notes={notes}
      onDelete={onDelete}
      onRefresh={onRefresh}
      onSave={onSave}
      recordId="record-1"
      saving={false}
    />
  );

  return { onRefresh, onSave, onDelete };
}

describe('ResearchNotesPanel', () => {
  it('renders placeholder when no notes exist', () => {
    renderPanel([]);

    expect(screen.getByText('No research notes for this record.')).toBeInTheDocument();
  });

  it('renders notes chronologically with titles and content', () => {
    renderPanel([
      makeNote({
        id: 'newest',
        title: 'Newer note',
        content: 'Newer content',
        createdAt: '2026-03-01T10:00:00.000Z',
      }),
      makeNote({
        id: 'oldest',
        title: 'Older note',
        content: 'Older content',
        createdAt: '2026-03-01T09:00:00.000Z',
      }),
    ]);

    const titles = Array.from(document.querySelectorAll('.planning-item-title')).map((node) => node.textContent);
    expect(titles).toEqual(['Older note', 'Newer note']);

    expect(screen.getByText('Older content')).toBeInTheDocument();
    expect(screen.getByText('Newer content')).toBeInTheDocument();
  });

  it('supports expand and collapse for note content details', () => {
    const { container } = render(
      <ResearchNotesPanel
        deleting={false}
        error={null}
        loading={false}
        notes={[
          makeNote({
            id: 'note-toggle',
            title: 'Toggle note',
            content: 'Hidden detail text',
          }),
        ]}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
        recordId="record-1"
        saving={false}
      />
    );

    const details = container.querySelector('details');
    const summary = screen.getByText('View note');

    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    fireEvent.click(summary);
    expect(details?.open).toBe(true);

    fireEvent.click(summary);
    expect(details?.open).toBe(false);
  });

  it('renders long note content in code-block container to prevent overflow breakage', () => {
    const longContent = 'long-content-'.repeat(200);

    const { container } = render(
      <ResearchNotesPanel
        deleting={false}
        error={null}
        loading={false}
        notes={[
          makeNote({
            id: 'long-note',
            title: 'Long note',
            content: longContent,
          }),
        ]}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
        recordId="record-1"
        saving={false}
      />
    );

    const pre = container.querySelector('pre.code-block');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('long-content-');
  });
});
