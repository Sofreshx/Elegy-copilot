import { useEffect, useState } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { hookRulesStore, type HookRulesState } from '../../stores/hookRulesStore';
import type { HookRule } from '../../lib/api/hooks';
import RemoteSessionsPanel from './RemoteSessionsPanel';

interface AppInfo {
  version?: string;
  channel?: string;
  routeCount?: number;
}

const SEVERITY_TONE: Record<string, 'danger' | 'accent' | 'brand' | 'neutral'> = {
  critical: 'danger',
  high: 'accent',
  medium: 'brand',
  low: 'neutral',
};

const CATEGORY_LABELS: Record<string, { emoji: string; label: string }> = {
  safety: { emoji: '⚠️', label: 'Safety Rules' },
  'anti-hang': { emoji: '🔄', label: 'Anti-Hang Rules' },
  telemetry: { emoji: '📝', label: 'Telemetry Rules' },
};

function HookRuleRow({ rule }: { rule: HookRule }) {
  return (
    <div className="settings-row" data-testid={`hook-rule-${rule.id}`}>
      <div className="settings-row-label">
        <strong>{rule.name}</strong>
        <span className="settings-row-description">{rule.description}</span>
      </div>
      <div className="settings-row-action">
        <Badge tone={SEVERITY_TONE[rule.severity] || 'neutral'} testId={`hook-severity-${rule.id}`}>
          {rule.severity}
        </Badge>
        <Button
          variant={rule.enabled ? 'primary' : 'secondary'}
          size="sm"
          testId={`hook-toggle-${rule.id}`}
          onClick={() => hookRulesStore.toggle(rule.id, !rule.enabled)}
        >
          {rule.enabled ? 'On' : 'Off'}
        </Button>
      </div>
    </div>
  );
}

function HookRulesPanel() {
  const hookState: HookRulesState = useStoreValue(hookRulesStore);

  useEffect(() => {
    void hookRulesStore.refresh();
  }, []);

  if (hookState.loading && hookState.rules.length === 0) {
    return (
      <Panel title="Hooks" subtitle="Runtime hook rules — all off by default" testId="settings-hooks">
        <p className="settings-about-loading">Loading…</p>
      </Panel>
    );
  }

  if (hookState.error && hookState.rules.length === 0) {
    return (
      <Panel title="Hooks" subtitle="Runtime hook rules" testId="settings-hooks">
        <p>Failed to load hook rules: {hookState.error}</p>
      </Panel>
    );
  }

  const categories = ['safety', 'anti-hang', 'telemetry'];
  const grouped = categories.map((cat) => ({
    category: cat,
    ...CATEGORY_LABELS[cat],
    rules: hookState.rules.filter((r) => r.category === cat),
  }));

  const enabledCount = hookState.rules.filter((r) => r.enabled).length;

  return (
    <Panel
      title="Hooks"
      subtitle={`Runtime hook rules — ${enabledCount} of ${hookState.rules.length} enabled`}
      testId="settings-hooks"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            testId="hooks-enable-safety"
            onClick={() => hookRulesStore.enableCategory('safety')}
          >
            Enable All Safety
          </Button>
          <Button
            variant="secondary"
            size="sm"
            testId="hooks-enable-all"
            onClick={() => hookRulesStore.enableAll()}
          >
            Enable All
          </Button>
          {enabledCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              testId="hooks-disable-all"
              onClick={() => hookRulesStore.disableAll()}
            >
              Disable All
            </Button>
          )}
        </>
      }
    >
      {grouped.map(({ category, emoji, label, rules }) =>
        rules.length > 0 ? (
          <div key={category} className="hook-category-group" data-testid={`hook-category-${category}`}>
            <h4 className="hook-category-heading">
              {emoji} {label}
            </h4>
            {rules.map((rule) => (
              <HookRuleRow key={rule.id} rule={rule} />
            ))}
          </div>
        ) : null,
      )}
    </Panel>
  );
}

export default function SettingsView() {
  const navigationState = useStoreValue(navigationStore);
  const [appInfo, setAppInfo] = useState<AppInfo>({});
  const [infoLoading, setInfoLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadInfo() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAppInfo({
              version: data.version,
              channel: data.channel,
              routeCount: data.routeCount,
            });
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    }

    void loadInfo();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="settings-view" data-testid="settings-view">
      <Toolbar testId="settings-toolbar">
        <h2>Settings</h2>
      </Toolbar>

      <div className="settings-content">
        <Panel title="Display" subtitle="UI preferences" testId="settings-display">
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>Admin Mode</strong>
              <span className="settings-row-description">
                Show diagnostic detail, raw JSON, and internal state across all views
              </span>
            </div>
            <div className="settings-row-action">
              <Button
                variant={navigationState.adminMode ? 'primary' : 'secondary'}
                size="sm"
                testId="settings-admin-toggle"
                onClick={() => navigationStore.toggleAdmin()}
              >
                {navigationState.adminMode ? 'On' : 'Off'}
              </Button>
              {navigationState.adminMode && (
                <Badge tone="accent" testId="settings-admin-badge">Active</Badge>
              )}
            </div>
          </div>
        </Panel>

        <HookRulesPanel />

        <RemoteSessionsPanel />

        <Panel title="Keyboard Shortcuts"subtitle="Navigation and actions" testId="settings-shortcuts">
          <dl className="settings-shortcuts-list">
            <dt><kbd>Ctrl+N</kbd></dt>
            <dd>New session wizard</dd>
            <dt><kbd>Ctrl+1</kbd> – <kbd>Ctrl+7</kbd></dt>
            <dd>Switch sidebar sections</dd>
            <dt><kbd>Escape</kbd></dt>
            <dd>Close wizard / back from detail view</dd>
          </dl>
        </Panel>

        <Panel title="About" subtitle="Application information" testId="settings-about">
          {infoLoading ? (
            <p className="settings-about-loading">Loading…</p>
          ) : (
            <dl className="settings-about-list">
              <dt>App</dt>
              <dd>Elegy Copilot</dd>
              {appInfo.version && (
                <>
                  <dt>Version</dt>
                  <dd data-testid="settings-about-version">{appInfo.version}</dd>
                </>
              )}
              {appInfo.channel && (
                <>
                  <dt>Channel</dt>
                  <dd data-testid="settings-about-channel">{appInfo.channel}</dd>
                </>
              )}
              {appInfo.routeCount != null && (
                <>
                  <dt>API Routes</dt>
                  <dd data-testid="settings-about-routes">{appInfo.routeCount}</dd>
                </>
              )}
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
