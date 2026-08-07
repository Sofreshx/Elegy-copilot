import './overseerShell.css';

export type OverseerSection = 'briefing' | 'projects' | 'knowledge' | 'tasks' | 'assistants';

const SECTIONS: Array<{ id: OverseerSection; label: string; description: string; enabled: boolean }> = [
  { id: 'briefing', label: 'Briefing', description: 'What matters now, what changed, and what needs you.', enabled: true },
  { id: 'projects', label: 'Projects', description: 'Repository facts, checkout context, pull requests, and analysis.', enabled: true },
  { id: 'knowledge', label: 'Knowledge', description: 'What Overseer knows, its freshness, and its evidence gaps.', enabled: true },
  { id: 'tasks', label: 'Tasks', description: 'Task state, review pressure, and explicit cleanup operations.', enabled: true },
  { id: 'assistants', label: 'Assistants', description: 'Hermes operations, models, automation, and quality evidence.', enabled: true },
];

export default function OverseerSectionNav({ active, onSelect }: { active: OverseerSection; onSelect: (section: OverseerSection) => void }) {
  return <nav className="overseer-section-nav" aria-label="Overseer sections" data-testid="overseer-section-nav">{SECTIONS.map((section) => <button type="button" key={section.id} className={active === section.id ? 'is-selected' : ''} aria-current={active === section.id ? 'page' : undefined} aria-disabled={!section.enabled} disabled={!section.enabled} title={section.description} onClick={() => onSelect(section.id)} data-testid={`overseer-section-${section.id}`}><span>{section.label}</span>{!section.enabled ? <small>Next</small> : null}</button>)}</nav>;
}
