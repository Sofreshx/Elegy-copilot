import { Toolbar } from '../../components';
import SessionsView from './SessionsView';

export default function SessionsWorkspaceView() {
  return (
    <section className="workspace-stack sessions-hub-view" data-testid="sessions-hub-view">
      <Toolbar testId="sessions-hub-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Sessions</p>
          <p className="workspace-nav-copy">Inspect local and SDK-backed sessions, stream messages, and launch isolated SDK work.</p>
        </div>
      </Toolbar>

      <p className="workspace-section-label">Runtime Sessions</p>
      <SessionsView />
    </section>
  );
}