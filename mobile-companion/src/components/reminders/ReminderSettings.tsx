/**
 * Reminder settings component for configuring stale idea notifications.
 */
import { useState, useEffect } from 'react';
import {
  remindersService,
  ReminderSettings,
  ReminderRule,
  ReminderInterval,
} from '../../services/remindersService';
import './ReminderSettings.css';

interface ReminderSettingsProps {
  onClose?: () => void;
}

const INTERVAL_OPTIONS: { value: ReminderInterval; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'never', label: 'Never' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'refining', label: 'Refining' },
  { value: 'planned', label: 'Planned' },
  { value: 'ready', label: 'Ready' },
  { value: 'queued', label: 'Queued' },
];

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function ReminderSettingsComponent({ onClose }: ReminderSettingsProps) {
  const [settings, setSettings] = useState<ReminderSettings>(remindersService.getSettings());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [editingRule, setEditingRule] = useState<ReminderRule | null>(null);

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const handleToggleEnabled = () => {
    const updated = { ...settings, enabled: !settings.enabled };
    setSettings(updated);
    remindersService.saveSettings(updated);
  };

  const handleTogglePush = async () => {
    if (!settings.pushEnabled) {
      const granted = await remindersService.requestPermission();
      if (!granted) {
        alert('Please enable notifications in your browser settings.');
        return;
      }
    }
    const updated = { ...settings, pushEnabled: !settings.pushEnabled };
    setSettings(updated);
    remindersService.saveSettings(updated);
    setNotificationPermission(Notification.permission);
  };

  const handleQuietHoursChange = (field: 'quietHoursStart' | 'quietHoursEnd', value: number) => {
    const updated = { ...settings, [field]: value };
    setSettings(updated);
    remindersService.saveSettings(updated);
  };

  const handleToggleRule = (ruleId: string) => {
    const updated = {
      ...settings,
      rules: settings.rules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      ),
    };
    setSettings(updated);
    remindersService.saveSettings(updated);
  };

  const handleDeleteRule = (ruleId: string) => {
    const updated = {
      ...settings,
      rules: settings.rules.filter((r) => r.id !== ruleId),
    };
    setSettings(updated);
    remindersService.saveSettings(updated);
  };

  const handleAddRule = () => {
    const newRule: ReminderRule = {
      id: crypto.randomUUID(),
      enabled: true,
      interval: 'weekly',
      staleDays: 7,
      statuses: ['draft'],
      priorities: ['high', 'medium'],
    };
    setEditingRule(newRule);
  };

  const handleSaveRule = (rule: ReminderRule) => {
    const exists = settings.rules.find((r) => r.id === rule.id);
    const updated = {
      ...settings,
      rules: exists
        ? settings.rules.map((r) => (r.id === rule.id ? rule : r))
        : [...settings.rules, rule],
    };
    setSettings(updated);
    remindersService.saveSettings(updated);
    setEditingRule(null);
  };

  return (
    <div className="reminder-settings">
      <header className="reminder-settings-header">
        <h2>Reminder Settings</h2>
        {onClose && (
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        )}
      </header>

      <div className="reminder-settings-content">
        {/* Main Toggle */}
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Enable Reminders</span>
            <span className="setting-description">
              Get notified about stale ideas
            </span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={handleToggleEnabled}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {/* Push Notifications */}
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Push Notifications</span>
            <span className="setting-description">
              {notificationPermission === 'denied'
                ? 'Blocked in browser settings'
                : notificationPermission === 'granted'
                  ? 'Enabled'
                  : 'Click to enable'}
            </span>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.pushEnabled && notificationPermission === 'granted'}
              onChange={handleTogglePush}
              disabled={notificationPermission === 'denied'}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {/* Quiet Hours */}
        <div className="setting-section">
          <h3>Quiet Hours</h3>
          <p className="section-description">
            No notifications during these hours
          </p>
          <div className="quiet-hours-row">
            <label>
              From
              <select
                value={settings.quietHoursStart}
                onChange={(e) =>
                  handleQuietHoursChange('quietHoursStart', Number(e.target.value))
                }
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              To
              <select
                value={settings.quietHoursEnd}
                onChange={(e) =>
                  handleQuietHoursChange('quietHoursEnd', Number(e.target.value))
                }
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Reminder Rules */}
        <div className="setting-section">
          <div className="section-header">
            <h3>Reminder Rules</h3>
            <button className="add-rule-button" onClick={handleAddRule}>
              + Add Rule
            </button>
          </div>

          <div className="rules-list">
            {settings.rules.map((rule) => (
              <div key={rule.id} className={`rule-card ${rule.enabled ? '' : 'disabled'}`}>
                <div className="rule-header">
                  <label className="toggle small">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggleRule(rule.id)}
                    />
                    <span className="toggle-slider" />
                  </label>
                  <span className="rule-summary">
                    Remind {rule.interval} if no updates for {rule.staleDays}+ days
                  </span>
                  <div className="rule-actions">
                    <button
                      className="edit-button"
                      onClick={() => setEditingRule(rule)}
                    >
                      Edit
                    </button>
                    <button
                      className="delete-button"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="rule-filters">
                  <span className="filter-tag">
                    Status: {rule.statuses.join(', ')}
                  </span>
                  <span className="filter-tag">
                    Priority: {rule.priorities.join(', ')}
                  </span>
                </div>
              </div>
            ))}

            {settings.rules.length === 0 && (
              <p className="no-rules">No reminder rules configured</p>
            )}
          </div>
        </div>
      </div>

      {/* Edit Rule Modal */}
      {editingRule && (
        <RuleEditorModal
          rule={editingRule}
          onSave={handleSaveRule}
          onCancel={() => setEditingRule(null)}
        />
      )}
    </div>
  );
}

interface RuleEditorModalProps {
  rule: ReminderRule;
  onSave: (rule: ReminderRule) => void;
  onCancel: () => void;
}

function RuleEditorModal({ rule, onSave, onCancel }: RuleEditorModalProps) {
  const [formData, setFormData] = useState(rule);

  const toggleArrayValue = (field: 'statuses' | 'priorities', value: string) => {
    const current = formData[field];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setFormData({ ...formData, [field]: updated });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="rule-editor-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{rule.id ? 'Edit Rule' : 'New Rule'}</h3>

        <div className="form-field">
          <label>Check Interval</label>
          <select
            value={formData.interval}
            onChange={(e) =>
              setFormData({ ...formData, interval: e.target.value as ReminderInterval })
            }
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Stale After (days)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={formData.staleDays}
            onChange={(e) =>
              setFormData({ ...formData, staleDays: Number(e.target.value) })
            }
          />
        </div>

        <div className="form-field">
          <label>Statuses</label>
          <div className="checkbox-group">
            {STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.statuses.includes(opt.value)}
                  onChange={() => toggleArrayValue('statuses', opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label>Priorities</label>
          <div className="checkbox-group">
            {PRIORITY_OPTIONS.map((opt) => (
              <label key={opt.value} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.priorities.includes(opt.value)}
                  onChange={() => toggleArrayValue('priorities', opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="save-button"
            onClick={() => onSave(formData)}
            disabled={formData.statuses.length === 0 || formData.priorities.length === 0}
          >
            Save Rule
          </button>
        </div>
      </div>
    </div>
  );
}
