import { useState } from 'react';
import OverseerSectionNav, { type OverseerSection } from './OverseerSectionNav';
import OverseerAssistantsView from './OverseerAssistantsView';
import OverseerCompanionChat from './OverseerCompanionChat';
import OverseerTopicView, { type OverseerEntity, type OverseerTopic } from './OverseerTopicView';
import './overseerShell.css';

export default function OverseerShell() {
  const [section, setSection] = useState<OverseerSection>('briefing');
  const [chatOpen, setChatOpen] = useState(false);
  const [companionPrompt, setCompanionPrompt] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<OverseerEntity | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ key: string; label: string; description: string; operation: string | null; mode: 'queue' | 'navigate'; requires?: string[]; section?: string | null } | null>(null);
  const isTopic = (value: OverseerSection): value is OverseerTopic => ['briefing', 'projects', 'knowledge', 'tasks'].includes(value);
  function handleAction(action: { key: string; label: string; description: string; operation: string | null; mode: 'queue' | 'navigate'; requires?: string[]; section?: string | null }) {
    setActionNotice(null);
    setPendingAction(action);
    setCompanionPrompt(null);
    setChatOpen(true);
  }
  return <div className="view-shell overseer-shell" data-testid="overseer-shell"><div className="overseer-shell-topbar"><div><span className="overseer-shell-mark" aria-hidden="true">O</span><strong>Overseer</strong><span className="overseer-shell-subtitle">Local assistant brain</span></div><div className="overseer-shell-topbar-actions"><span className="overseer-shell-authority"><i aria-hidden="true" /> local authority</span><button type="button" className="overseer-companion-launch" onClick={() => { setActionNotice(null); setPendingAction(null); setCompanionPrompt(null); setChatOpen(true); }}><span aria-hidden="true">✦</span> Work</button></div></div><OverseerSectionNav active={section} onSelect={(next) => { setActionNotice(null); setPendingAction(null); setCompanionPrompt(null); setSelectedEntity(null); setSection(next); }} />{actionNotice ? <div className="overseer-shell-notice" role="status">{actionNotice}<button type="button" onClick={() => setActionNotice(null)} aria-label="Dismiss notice">×</button></div> : null}{selectedEntity ? <div className="overseer-shell-context" role="status"><span>Companion context: <strong>{selectedEntity.name ?? selectedEntity.kind}</strong></span><button type="button" onClick={() => setSelectedEntity(null)}>Clear</button></div> : null}{isTopic(section) ? <OverseerTopicView topic={section} onAction={handleAction} onSelectEntity={(entity) => { setSelectedEntity(entity); setActionNotice(`${entity.name ?? entity.kind} is now the companion context.`); }} /> : <OverseerAssistantsView />}<OverseerCompanionChat topic={section} open={chatOpen} selectedEntity={selectedEntity} pendingAction={pendingAction} initialPrompt={companionPrompt} onPromptConsumed={() => setCompanionPrompt(null)} onActionConsumed={() => setPendingAction(null)} onNavigate={(next) => { if (next === 'assistants' || isTopic(next as OverseerSection)) setSection(next as OverseerSection); setChatOpen(false); }} onClose={() => setChatOpen(false)} /></div>;
}
