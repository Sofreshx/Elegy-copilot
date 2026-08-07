import { useState } from 'react';
import OverseerSectionNav, { type OverseerSection } from './OverseerSectionNav';
import OverseerAssistantsView from './OverseerAssistantsView';
import OverseerRunsDrawer from './OverseerRunsDrawer';
import OverseerCompanionChat from './OverseerCompanionChat';
import OverseerTopicView, { type OverseerEntity, type OverseerTopic } from './OverseerTopicView';
import './overseerShell.css';

export default function OverseerShell() {
  const [section, setSection] = useState<OverseerSection>('briefing');
  const [runsOpen, setRunsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [companionPrompt, setCompanionPrompt] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<OverseerEntity | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const isTopic = (value: OverseerSection): value is OverseerTopic => ['briefing', 'projects', 'knowledge', 'tasks'].includes(value);
  function handleAction(action: { label: string; description: string }) {
    setActionNotice(`${action.label} is available as a bounded Overseer operation. Use the contextual companion to refine or launch it.`);
    setCompanionPrompt(`${action.label} for the current ${section} context. Explain what will be observed, what the bounded operation will produce, and queue it if the request is explicit.`);
    setChatOpen(true);
  }
  return <div className="view-shell overseer-shell" data-testid="overseer-shell"><div className="overseer-shell-topbar"><div><span className="overseer-shell-mark" aria-hidden="true">O</span><strong>Overseer</strong><span className="overseer-shell-subtitle">Local assistant brain</span></div><div className="overseer-shell-topbar-actions"><span className="overseer-shell-authority"><i aria-hidden="true" /> local authority</span><button type="button" className="overseer-companion-launch" onClick={() => { setActionNotice(null); setCompanionPrompt(null); setChatOpen(true); }}><span aria-hidden="true">✦</span> Ask companion</button><button type="button" className="overseer-runs-launch" onClick={() => { setActionNotice(null); setRunsOpen(true); }}><span aria-hidden="true">◉</span> Runs</button></div></div><OverseerSectionNav active={section} onSelect={(next) => { setActionNotice(null); setCompanionPrompt(null); setSelectedEntity(null); setSection(next); }} />{actionNotice ? <div className="overseer-shell-notice" role="status">{actionNotice}<button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss notice">×</button></div> : null}{selectedEntity ? <div className="overseer-shell-context" role="status"><span>Companion context: <strong>{selectedEntity.name ?? selectedEntity.kind}</strong></span><button type="button" onClick={() => setSelectedEntity(null)}>Clear</button></div> : null}{isTopic(section) ? <OverseerTopicView topic={section} onAction={handleAction} onSelectEntity={(entity) => { setSelectedEntity(entity); setActionNotice(`${entity.name ?? entity.kind} is now the companion context.`); }} /> : <OverseerAssistantsView />}<OverseerRunsDrawer open={runsOpen} onClose={() => setRunsOpen(false)} /><OverseerCompanionChat topic={section} open={chatOpen} selectedEntity={selectedEntity} initialPrompt={companionPrompt} onPromptConsumed={() => setCompanionPrompt(null)} onClose={() => setChatOpen(false)} /></div>;
}
