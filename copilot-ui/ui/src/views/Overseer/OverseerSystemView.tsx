import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '../../components';
import { setOverseerWorkShellState } from './overseerWorkStore';
import './overseerSystem.css';

type SystemStatus = 'ready' | 'attention' | 'unknown';

interface SystemSummary {
  format: string;
  generatedAt: string | null;
  overview: {
    status: SystemStatus;
    message: string;
    attentionCount: number;
    checkedAt: string | null;
    snapshotStatus: string;
    dispatcher: { state: string; healthy: boolean; observedAt: string | null };
  };
  services: Array<{ label: string; status: string; message: string; checkedAt: string | null; healthStatus: string; readiness: string; latestAction: string | null; availableActions: string[] }>;
  reflection: {
    openFindings: number;
    proposalsAwaitingReview: number;
    activeExperiments: number;
    latestAssessmentAt: string | null;
    findings: Array<{ title: string; summary: string; severity: string; state: string; updatedAt: string | null }>;
    proposals: Array<{ title: string; summary: string; state: string; updatedAt: string | null }>;
    experiments: Array<{ title: string; summary: string; state: string; updatedAt: string | null }>;
    selfModels: Array<{ label: string; status: string; assessedAt: string | null }>;
  };
  skills: {
    profiles: Array<{ label: string; status: string; skillCount: number; pendingCount: number; attention: boolean }>;
    items: Array<{ label: string; summary: string; lifecycle: string; provenance: string; useCount: number; lastUsedAt: string | null; attention: boolean }>;
    pendingCount: number;
    attentionCount: number;
  };
  cohort: { label: string; status: string; reviewedCount: number; acceptableCount: number; gates: Array<{ label: string; status: string; summary: string }> };
  migration: { pendingCount: number; acceptedCount: number; batchCount: number; duplicateCount: number; originalsPreserved: boolean; status: string };
}

interface OverseerStatus {
  status: 'ready' | 'starting' | 'stopped' | 'degraded' | 'unavailable' | 'prerequisite_missing';
  reasonCode?: string;
  description?: string;
  checkedAt?: string;
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(init?.headers || {}) }, ...init });
  const payload = await response.json().catch(() => null) as (T & { message?: string; error?: string }) | null;
  if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : 'The request could not be completed.');
  return payload as T;
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function stateLabel(value: string): string { return String(value || 'unknown').replaceAll('-', ' '); }

function toneForStatus(value: string): 'neutral' | 'brand' | 'success' | 'danger' {
  const status = String(value).toLowerCase();
  if (['ready', 'passed', 'up to date', 'assessed', 'healthy'].includes(status)) return 'success';
  if (['attention', 'needs attention', 'pending', 'needs-assessment', 'degraded', 'unavailable', 'stopped', 'malformed'].includes(status)) return 'danger';
  if (['running', 'planned', 'working'].includes(status)) return 'brand';
  return 'neutral';
}

function Recovery({ service, busy, onStart }: { service: OverseerStatus | null; busy: boolean; onStart: () => void }) {
  return <section className="overseer-system-recovery" data-testid="overseer-system-recovery"><div><p className="overseer-work-eyebrow">Source-owned service</p><h2>Overseer is unavailable</h2><p>{service?.description || 'Elegy cannot read System until the local Overseer service is ready.'}</p><span>{stateLabel(service?.reasonCode || 'connection unavailable')}</span></div><div><Button onClick={onStart} disabled={busy} loading={busy} loadingLabel="Starting…">Start Overseer</Button><p>Elegy holds no Overseer token in the browser.</p></div></section>;
}

function ServiceHealth({ summary }: { summary: SystemSummary }) {
  return <section className="overseer-system-card" data-testid="overseer-system-services"><div className="overseer-system-heading"><div><p className="overseer-work-eyebrow">Source-owned services</p><h2>Service health</h2><p>See what is reachable before you start a review or migration.</p></div><span className="overseer-system-count">{summary.services.length}</span></div><div className="overseer-system-service-list">{summary.services.length ? summary.services.map((service) => <article className="overseer-system-service" key={service.label}><div className="overseer-system-service-head"><div><strong>{service.label}</strong><span>{service.message}</span></div><Badge tone={toneForStatus(service.status)}>{stateLabel(service.status)}</Badge></div><footer><span>{service.readiness !== 'unknown' ? `Readiness ${stateLabel(service.readiness)}` : 'Readiness not recorded'}</span><span>{service.checkedAt ? `Checked ${formatWhen(service.checkedAt)}` : 'No observation yet'}</span></footer></article>) : <p className="overseer-system-empty">No service observations are available yet.</p>}</div></section>;
}

function Reflection({ summary }: { summary: SystemSummary }) {
  const { reflection } = summary;
  return <section className="overseer-system-card" data-testid="overseer-system-reflection"><div className="overseer-system-heading"><div><p className="overseer-work-eyebrow">Reflection and improvement</p><h2>Keep the loop honest</h2><p>Findings and proposals stay reviewable; no canonical changes happen here automatically.</p></div></div><div className="overseer-system-metrics"><div><strong>{reflection.openFindings}</strong><span>open findings</span></div><div><strong>{reflection.proposalsAwaitingReview}</strong><span>proposals to review</span></div><div><strong>{reflection.activeExperiments}</strong><span>active experiments</span></div><div><strong>{reflection.selfModels.filter((item) => item.status === 'assessed').length}/{reflection.selfModels.length}</strong><span>systems assessed</span></div></div><details className="overseer-system-details"><summary>Review details</summary><div className="overseer-system-detail-grid"><div><h3>Findings</h3>{reflection.findings.length ? reflection.findings.slice(0, 5).map((finding) => <article key={`${finding.title}-${finding.updatedAt}`}><div><strong>{finding.title}</strong><Badge tone={toneForStatus(finding.state)}>{stateLabel(finding.state)}</Badge></div><p>{finding.summary}</p><small>{stateLabel(finding.severity)} · {formatWhen(finding.updatedAt)}</small></article>) : <p className="overseer-system-empty">No findings submitted.</p>}</div><div><h3>Proposals</h3>{reflection.proposals.length ? reflection.proposals.slice(0, 5).map((proposal) => <article key={`${proposal.title}-${proposal.updatedAt}`}><div><strong>{proposal.title}</strong><Badge tone={toneForStatus(proposal.state)}>{stateLabel(proposal.state)}</Badge></div><p>{proposal.summary}</p><small>{formatWhen(proposal.updatedAt)}</small></article>) : <p className="overseer-system-empty">No improvement proposals.</p>}</div></div></details></section>;
}

function Skills({ summary }: { summary: SystemSummary }) {
  return <section className="overseer-system-card" data-testid="overseer-system-skills"><div className="overseer-system-heading"><div><p className="overseer-work-eyebrow">Hermes governance</p><h2>Skills and profiles</h2><p>Profiles are summarized by readiness; runner configuration stays technical.</p></div><span className="overseer-system-count">{summary.skills.attentionCount}</span></div><div className="overseer-system-profile-grid">{summary.skills.profiles.map((profile) => <article key={profile.label}><div><strong>{profile.label}</strong><Badge tone={toneForStatus(profile.status)}>{stateLabel(profile.status)}</Badge></div><p>{profile.skillCount} skills · {profile.pendingCount} staged candidates</p></article>)}</div><details className="overseer-system-details"><summary>Show governed skills</summary><div className="overseer-system-skill-list">{summary.skills.items.length ? summary.skills.items.slice(0, 12).map((skill) => <article key={`${skill.label}-${skill.lifecycle}`}><div><strong>{skill.label}</strong><Badge tone={toneForStatus(skill.lifecycle)}>{stateLabel(skill.lifecycle)}</Badge></div><p>{skill.summary}</p><small>{stateLabel(skill.provenance)} · used {skill.useCount} times{skill.lastUsedAt ? ` · ${formatWhen(skill.lastUsedAt)}` : ''}</small></article>) : <p className="overseer-system-empty">No governed skills are projected.</p>}</div></details></section>;
}

function CohortAndMigration({ summary }: { summary: SystemSummary }) {
  return <div className="overseer-system-two-column"><section className="overseer-system-card" data-testid="overseer-system-cohort"><div className="overseer-system-heading"><div><p className="overseer-work-eyebrow">Acceptance evidence</p><h2>{summary.cohort.label}</h2></div><Badge tone={toneForStatus(summary.cohort.status)}>{stateLabel(summary.cohort.status)}</Badge></div><p className="overseer-system-card-copy">{summary.cohort.reviewedCount} reviewed · {summary.cohort.acceptableCount} acceptable. Gates are evidence-only.</p><div className="overseer-system-gates">{summary.cohort.gates.map((gate) => <div key={gate.label}><div><strong>{gate.label}</strong><Badge tone={toneForStatus(gate.status)}>{stateLabel(gate.status)}</Badge></div><p>{gate.summary}</p></div>)}</div></section><section className="overseer-system-card" data-testid="overseer-system-migration"><div className="overseer-system-heading"><div><p className="overseer-work-eyebrow">Advanced migration</p><h2>Legacy task cleanup</h2></div><Badge tone={toneForStatus(summary.migration.status)}>{stateLabel(summary.migration.status)}</Badge></div><p className="overseer-system-card-copy">{summary.migration.pendingCount} rows still need a reviewed mapping across {summary.migration.batchCount} batches.</p><dl className="overseer-system-migration-stats"><div><dt>Accepted</dt><dd>{summary.migration.acceptedCount}</dd></div><div><dt>Duplicates</dt><dd>{summary.migration.duplicateCount}</dd></div><div><dt>Source preserved</dt><dd>{summary.migration.originalsPreserved ? 'Yes' : 'Check'}</dd></div></dl><details className="overseer-system-details"><summary>Migration notes</summary><p>Legacy migration remains an advanced System operation. Review locally before any semantic comparison; originals remain preserved.</p></details></section></div>;
}

export default function OverseerSystemView() {
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [service, setService] = useState<OverseerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [systemResult, serviceResult] = await Promise.allSettled([
      readJson<SystemSummary>('/api/overseer/system/v1/summary'),
      readJson<OverseerStatus>('/api/intelligence-surfaces/overseer'),
    ]);
    if (serviceResult.status === 'fulfilled') {
      setService(serviceResult.value);
      setOverseerWorkShellState({ availability: serviceResult.value.status === 'ready' ? 'ready' : serviceResult.value.status === 'prerequisite_missing' ? 'unavailable' : serviceResult.value.status });
    } else {
      setService(null);
      setOverseerWorkShellState({ availability: 'unavailable' });
    }
    if (systemResult.status === 'fulfilled') setSummary(systemResult.value);
    else { setSummary(null); setError(systemResult.reason instanceof Error ? systemResult.reason.message : 'Unable to read System from Overseer.'); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function startOverseer() {
    if (!service || !window.confirm('Start Overseer?')) return;
    setBusy(true);
    try {
      await readJson('/api/intelligence-surfaces/overseer/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'start:overseer', observedAt: service.checkedAt }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const unavailable = service && service.status !== 'ready';
  return <div className="view-shell overseer-system-view" data-testid="overseer-system-view"><header className="overseer-system-hostbar"><div><p className="overseer-work-eyebrow">Overseer · System</p><h1>System</h1><p>Keep services healthy, learning reviewable, and migrations bounded.</p></div><div className="overseer-system-hostbar-actions"><span className="overseer-work-authority">Source-owned local authority</span><Button variant="secondary" onClick={() => void load()} loading={loading} loadingLabel="Refreshing…">Refresh</Button></div></header>{error ? <p className="overseer-work-error" role="alert">{error}</p> : null}{unavailable ? <Recovery service={service} busy={busy} onStart={() => void startOverseer()} /> : null}<div className="view-scroll overseer-system-scroll"><main className="overseer-system-content">{loading && !summary ? <p className="state-message">Reading System from Overseer…</p> : null}{summary ? <><section className="overseer-system-overview" data-testid="overseer-system-overview"><div><p className="overseer-work-eyebrow">Daily check</p><h2>{summary.overview.message}</h2><p>System status is a bounded projection. Use the details drawers when you need operator context.</p></div><div className="overseer-system-overview-status"><Badge tone={toneForStatus(summary.overview.status)}>{stateLabel(summary.overview.status)}</Badge><strong>{summary.overview.attentionCount}</strong><span>areas needing attention</span></div></section><section className="overseer-system-metric-grid"><div><span>Services</span><strong>{summary.services.length}</strong><small>source-owned checks</small></div><div><span>Open findings</span><strong>{summary.reflection.openFindings}</strong><small>reviewable signals</small></div><div><span>Skills needing review</span><strong>{summary.skills.attentionCount}</strong><small>governed procedures</small></div><div><span>Migration rows</span><strong>{summary.migration.pendingCount}</strong><small>advanced operation</small></div></section><ServiceHealth summary={summary} /><div className="overseer-system-two-column"><Reflection summary={summary} /><Skills summary={summary} /></div><CohortAndMigration summary={summary} /><footer className="overseer-system-footer"><span>Projection refreshed {formatWhen(summary.generatedAt)}</span><span>Dispatcher {summary.overview.dispatcher.healthy ? 'healthy' : 'needs attention'} · {stateLabel(summary.overview.dispatcher.state)}</span><span>Snapshot {stateLabel(summary.overview.snapshotStatus)}</span></footer></> : null}</main></div></div>;
}
