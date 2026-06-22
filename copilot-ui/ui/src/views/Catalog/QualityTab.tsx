import { useEffect, useState } from 'react';
import type { SkillQualityReport, SkillQualityDiagnostic } from '../../lib/types';
import { getSkillQuality } from '../../lib/api';
import { Badge, Panel } from '../../components';

export default function QualityTab() {
  const [report, setReport] = useState<SkillQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getSkillQuality();
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load quality data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="assets-tools-empty state-message" data-testid="quality-loading">Loading quality diagnostics...</p>;
  }

  if (error) {
    return <p className="assets-tools-empty state-error" data-testid="quality-error">{error}</p>;
  }

  if (!report) {
    return <p className="assets-tools-empty" data-testid="quality-empty">No quality data available.</p>;
  }

  const { summary, skills, overlapClusters } = report;
  const skillsWithIssues = (skills ?? []).filter((s) => s.diagnostics.length > 0);

  // Filter out expected cross-harness duplicate-name warnings
  // (engine-assets and opencode-assets having same-named skills is by design)
  const displaySkills = skillsWithIssues.map((skill) => {
    const filteredDiagnostics = skill.diagnostics.filter((d) => {
      if (d.kind === 'duplicate-name') {
        // Only show duplicate-name if it's NOT a cross-root duplicate
        // (same name in different source roots like engine-assets vs opencode-assets)
        const peerIds: string[] = Array.isArray((d.detail as any)?.peerSkillIds)
          ? (d.detail as any).peerSkillIds
          : [];
        if (peerIds.length > 0) {
          const myRoot = skill.sourceRoot;
          const allDifferentRoot = peerIds.every((pid) => {
            const peerSkill = skills.find((s) => s.skillId === pid);
            return peerSkill && peerSkill.sourceRoot !== myRoot;
          });
          // If all peers are in different roots, this is a cross-harness copy - expected
          if (allDifferentRoot) return false;
        }
      }
      return true;
    });
    return { ...skill, diagnostics: filteredDiagnostics };
  }).filter((skill) => skill.diagnostics.length > 0);

  // Also filter overlapClusters to remove cross-root overlaps that are expected
  const displayOverlapClusters = (overlapClusters ?? []).filter((cluster) => {
    // Get source roots for each skill in the cluster
    const roots = cluster.skills.map((skillId) => {
      const skill = (skills ?? []).find((s) => s.skillId === skillId);
      return skill?.sourceRoot || '';
    });
    const uniqueRoots = new Set(roots.filter(Boolean));
    // Keep only clusters where some skills share the same root (genuine within-root overlap)
    // Exclude clusters where every skill is from a different root (cross-harness copies)
    return uniqueRoots.size <= 1 || uniqueRoots.size < cluster.skills.length;
  });

  // Count only non-cross-root duplicate names for the metric display
  const filteredDuplicateNames = (skills ?? []).reduce((count, skill) => {
    return count + skill.diagnostics.filter((d) => {
      if (d.kind !== 'duplicate-name') return false;
      const peerIds: string[] = Array.isArray((d.detail as any)?.peerSkillIds)
        ? (d.detail as any).peerSkillIds
        : [];
      if (peerIds.length > 0) {
        const peerSkills = peerIds.map((pid) => skills.find((s) => s.skillId === pid)).filter(Boolean);
        const allDifferentRoot = peerSkills.every((ps) => ps && ps.sourceRoot !== skill.sourceRoot);
        if (allDifferentRoot) return false;
      }
      return true;
    }).length;
  }, 0);

  function severityTone(severity: SkillQualityDiagnostic['severity']): 'danger' | 'accent' | 'neutral' {
    switch (severity) {
      case 'error': return 'danger';
      case 'warning': return 'accent';
      default: return 'neutral';
    }
  }

  return (
    <div data-testid="assets-tools-quality" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', overflow: 'auto' }}>
      {/* Summary */}
      <div className="assets-tools-metrics" data-testid="quality-summary">
        <div className="assets-tools-metric-card catalog-stat-card">
          <div>
            <p className="assets-tools-metric-label catalog-stat-label">Analyzed Skills</p>
            <p className="assets-tools-metric-value catalog-stat-value">{summary.totalSkills}</p>
          </div>
        </div>
        <div className="assets-tools-metric-card catalog-stat-card">
          <div>
            <p className="assets-tools-metric-label catalog-stat-label">Skills with Issues</p>
            <p className="assets-tools-metric-value catalog-stat-value" style={{ color: summary.skillsWithIssues > 0 ? 'var(--color-warning-500)' : 'var(--color-success-500)' }}>
              {summary.skillsWithIssues}
            </p>
          </div>
        </div>
        <div className="assets-tools-metric-card catalog-stat-card">
          <div>
            <p className="assets-tools-metric-label catalog-stat-label">Weak Descriptions</p>
            <p className="assets-tools-metric-value catalog-stat-value">{summary.weakDescriptions}</p>
          </div>
        </div>
        <div className="assets-tools-metric-card catalog-stat-card">
          <div>
            <p className="assets-tools-metric-label catalog-stat-label">Duplicate Names</p>
            <p className="assets-tools-metric-value catalog-stat-value">{filteredDuplicateNames}</p>
          </div>
        </div>
        <div className="assets-tools-metric-card catalog-stat-card">
          <div>
            <p className="assets-tools-metric-label catalog-stat-label">Overlaps</p>
            <p className="assets-tools-metric-value catalog-stat-value">{overlapClusters.length}</p>
          </div>
        </div>
      </div>

      {/* Skill diagnostics */}
      {displaySkills.length > 0 && (
        <Panel title={`Skills with Issues (${displaySkills.length})`} subtitle="Diagnostics grouped by skill">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {displaySkills.map((skill) => (
              <div key={skill.skillId} className="assets-tools-item-card" data-testid={`quality-skill-${skill.skillId}`}>
                <div className="assets-tools-item-header">
                  <span>{skill.name}</span>
                  <div className="assets-tools-item-badges">
                    <Badge tone="neutral">{skill.sourceRoot}</Badge>
                    <Badge tone={skill.diagnostics.length > 2 ? 'danger' : 'accent'}>
                      {skill.diagnostics.length} issue{skill.diagnostics.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>
                {skill.description && <p className="assets-tools-item-description">{skill.description}</p>}
                {skill.diagnostics.map((d, i) => (
                  <div key={i} style={{ padding: 'var(--space-xs)', borderLeft: `3px solid var(--color-${severityTone(d.severity) === 'danger' ? 'danger' : severityTone(d.severity) === 'accent' ? 'warning' : 'ink'}-500)`, marginTop: 'var(--space-2xs)' }}>
                    <Badge tone={severityTone(d.severity)}>{d.kind}</Badge>
                    <span style={{ marginLeft: 'var(--space-xs)', fontSize: '0.82rem' }}>{d.message}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Overlap clusters */}
      {displayOverlapClusters.length > 0 && (
        <Panel title={`Overlap Clusters (${displayOverlapClusters.length})`} subtitle="Skills with potentially overlapping scope">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {displayOverlapClusters.map((cluster, i) => (
              <div key={i} className="assets-tools-item-card" data-testid={`quality-cluster-${i}`}>
                <div className="assets-tools-item-header">
                  <span>Cluster {i + 1}</span>
                  <div className="assets-tools-item-badges">
                    <Badge tone="accent">{cluster.reason}</Badge>
                    <Badge tone="neutral">score: {cluster.score.toFixed(2)}</Badge>
                  </div>
                </div>
                <div className="assets-tools-item-description">
                  {cluster.skills.join(' \u00b7 ')}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Clean state */}
      {displaySkills.length === 0 && displayOverlapClusters.length === 0 && (
        <p className="assets-tools-empty" style={{ color: 'var(--color-success-500)' }}>
          All skills pass quality checks. No issues detected.
        </p>
      )}
    </div>
  );
}
