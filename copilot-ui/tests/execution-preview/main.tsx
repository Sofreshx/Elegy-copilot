import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../ui/src/styles/reset.css';
import '../../ui/src/styles/tokens.css';
import '../../ui/src/styles/global.css';
import '../../ui/src/app.css';
import WorkspaceExecutionTab from '../../ui/src/views/Workspace/WorkspaceExecutionTab';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ padding: '24px' }}>
      <WorkspaceExecutionTab repoPath="/preview/repo" repoId="repo-1" repoLabel="Preview Repo" />
    </div>
  </React.StrictMode>,
);
