import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSettings, useSetNotification } from '../hooks/useSettings';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { getRelayConnection, type ConnectionStatus } from '../services/relayConnection';
import AgentSelector from '../components/settings/AgentSelector';
import SkillsList from '../components/settings/SkillsList';
import appPackage from '../../package.json';
import './Settings.css';

type SettingsTab = 'general' | 'agents' | 'skills';

export default function Settings() {
  const { user, logout } = useAuth();
  const { data: settings } = useSettings();
  const setNotification = useSetNotification();
  const { isInstallable, installApp } = useInstallPrompt();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [relayStatus, setRelayStatus] = useState<ConnectionStatus>('disconnected');

  useEffect(() => {
    const relay = getRelayConnection();
    const unsubscribe = relay.onStatusChange(setRelayStatus);
    return () => unsubscribe();
  }, []);

  const handleNotificationToggle = (key: 'permissionRequests' | 'sessionUpdates' | 'reminders') => {
    if (settings) {
      setNotification.mutate({ key, enabled: !settings.notifications[key] });
    }
  };

  return (
    <div className="page settings">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configuration and account</p>
      </header>

      <nav className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          className={`settings-tab ${activeTab === 'agents' ? 'active' : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agents
        </button>
        <button
          className={`settings-tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
        >
          Skills
        </button>
      </nav>

      {activeTab === 'general' && (
        <>
          <section className="settings-section">
            <h2 className="section-title">Account</h2>
            <div className="card">
              <div className="user-info">
                {user?.avatarUrl && (
                  <img src={user.avatarUrl} alt="" className="user-avatar" />
                )}
                <div className="user-details">
                  <span className="user-name">{user?.name || user?.login || 'Unknown'}</span>
                  <span className="user-login">@{user?.login || 'unknown'}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Connection</h2>
            <div className="card">
              <div className="setting-row">
                <span className="setting-label">Relay Server</span>
                <span className="setting-value">Auto</span>
              </div>
              <div className="setting-row">
                <span className="setting-label">Status</span>
                <span className={`status-badge ${relayStatus === 'connected' ? 'online' : 'offline'}`}>
                  <span className="status-dot" />
                  {relayStatus === 'connected' ? 'Connected' :
                   relayStatus === 'connecting' ? 'Connecting…' :
                   relayStatus === 'reconnecting' ? 'Reconnecting…' :
                   'Disconnected'}
                </span>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Notifications</h2>
            <div className="card">
              <div className="setting-row clickable" onClick={() => handleNotificationToggle('permissionRequests')}>
                <span className="setting-label">Permission Requests</span>
                <span className={`toggle-indicator ${settings?.notifications.permissionRequests ? 'on' : 'off'}`} />
              </div>
              <div className="setting-row clickable" onClick={() => handleNotificationToggle('sessionUpdates')}>
                <span className="setting-label">Session Updates</span>
                <span className={`toggle-indicator ${settings?.notifications.sessionUpdates ? 'on' : 'off'}`} />
              </div>
              <div className="setting-row clickable" onClick={() => handleNotificationToggle('reminders')}>
                <span className="setting-label">Reminders</span>
                <span className={`toggle-indicator ${settings?.notifications.reminders ? 'on' : 'off'}`} />
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">About</h2>
            <div className="card">
              <div className="setting-row">
                <span className="setting-label">Version</span>
                <span className="setting-value">{appPackage.version}</span>
              </div>
            </div>
          </section>

          {isInstallable && (
            <section className="settings-section">
              <button className="install-button" onClick={installApp}>
                Install App
              </button>
            </section>
          )}

          <section className="settings-section">
            <button className="logout-button" onClick={logout}>
              Sign Out
            </button>
          </section>
        </>
      )}

      {activeTab === 'agents' && (
        <section className="settings-section">
          <h2 className="section-title">Default Agent</h2>
          <p className="section-description">
            Select the agent that will be used when starting new sessions from the mobile app.
          </p>
          <AgentSelector />
        </section>
      )}

      {activeTab === 'skills' && (
        <section className="settings-section">
          <h2 className="section-title">Skills</h2>
          <p className="section-description">
            Enable or disable skills. Disabled skills won't be suggested to agents.
          </p>
          <SkillsList />
        </section>
      )}
    </div>
  );
}
