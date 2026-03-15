import { useState } from 'react';
import { Button, Toolbar } from '../../components';
import SandboxesView from '../Sandboxes/SandboxesView';
import SessionsView from './SessionsView';

type SessionsSectionId = 'runtime' | 'sandboxes';

const SECTION_COPY: Record<SessionsSectionId, { title: string; body: string }> = {
  runtime: {
    title: 'Runtime Sessions',
    body: 'Inspect local and SDK-backed sessions, stream messages, and launch isolated SDK work.',
  },
  sandboxes: {
    title: 'Sandbox Environments',
    body: 'Manage sandbox lifecycle, branch context, and follow sandbox work back into runtime sessions.',
  },
};

export default function SessionsWorkspaceView() {
  const [activeSection, setActiveSection] = useState<SessionsSectionId>('runtime');
  const sectionCopy = SECTION_COPY[activeSection];

  return (
    <section className="workspace-stack sessions-hub-view" data-testid="sessions-hub-view">
      <Toolbar testId="sessions-hub-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Sessions</p>
          <p className="workspace-nav-copy">{sectionCopy.body}</p>
        </div>

        <div className="workspace-nav" role="tablist" aria-label="Sessions workspaces">
          <Button
            onClick={() => setActiveSection('runtime')}
            testId="sessions-section-runtime"
            variant={activeSection === 'runtime' ? 'primary' : 'ghost'}
          >
            Runtime
          </Button>
          <Button
            onClick={() => setActiveSection('sandboxes')}
            testId="sessions-section-sandboxes"
            variant={activeSection === 'sandboxes' ? 'primary' : 'ghost'}
          >
            Sandboxes
          </Button>
        </div>
      </Toolbar>

      <p className="workspace-section-label">{sectionCopy.title}</p>

      {activeSection === 'runtime' ? <SessionsView /> : null}
      {activeSection === 'sandboxes' ? (
        <SandboxesView
          onFollowSessions={() => {
            setActiveSection('runtime');
          }}
        />
      ) : null}
    </section>
  );
}