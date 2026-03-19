import { Button } from '../../components';

function buildVsCodeFileUrl(targetPath: string): string | null {
  const normalizedPath = targetPath.trim().replace(/\\/g, '/');
  if (!normalizedPath) {
    return null;
  }

  const prefixedPath = /^[A-Za-z]:\//.test(normalizedPath)
    ? `/${normalizedPath}`
    : (normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`);

  return `vscode://file${encodeURI(prefixedPath)}`;
}

export default function PlanningPathActions(props: {
  path?: string | null;
  repoRelativePath?: string | null;
  openLabel?: string;
  emptyMessage?: string;
  testIdPrefix: string;
}) {
  const path = typeof props.path === 'string' ? props.path.trim() : '';
  const repoRelativePath = typeof props.repoRelativePath === 'string' ? props.repoRelativePath.trim() : '';
  const vscodeUrl = path ? buildVsCodeFileUrl(path) : null;
  const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  return (
    <div className="planning-controls" data-testid={`${props.testIdPrefix}-location`}>
      {repoRelativePath ? (
        <p className="planning-copy">
          Repo-relative: <code>{repoRelativePath}</code>
        </p>
      ) : null}
      {path ? (
        <>
          <pre className="code-block planning-path-block" data-testid={`${props.testIdPrefix}-path`}>
            <code>{path}</code>
          </pre>
          <div className="planning-actions">
            <Button
              disabled={!canCopy}
              onClick={() => {
                if (canCopy) {
                  void navigator.clipboard.writeText(path);
                }
              }}
              testId={`${props.testIdPrefix}-copy`}
              variant="ghost"
            >
              Copy path
            </Button>
            <Button
              disabled={!vscodeUrl}
              onClick={() => {
                if (vscodeUrl) {
                  window.open(vscodeUrl, '_blank', 'noopener,noreferrer');
                }
              }}
              testId={`${props.testIdPrefix}-open`}
              variant="secondary"
            >
              {props.openLabel || 'Open in VS Code'}
            </Button>
          </div>
        </>
      ) : (
        <p className="state-message">{props.emptyMessage || 'No file path resolved yet.'}</p>
      )}
    </div>
  );
}
