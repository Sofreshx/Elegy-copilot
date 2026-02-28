import Badge from './Badge';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogViewerLine {
  message: string;
  level?: LogLevel;
  timestamp?: string;
}

type InputLine = string | LogViewerLine;

interface LogViewerProps {
  lines?: InputLine[];
  showLevel?: boolean;
  testId?: string;
}

function normalizeLine(line: InputLine): LogViewerLine {
  if (typeof line === 'string') {
    return { message: line };
  }

  return line;
}

function levelTone(level: LogLevel | undefined): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'accent';
  if (level === 'success') return 'success';
  if (level === 'info') return 'brand';
  return 'neutral';
}

export default function LogViewer({ lines = [], showLevel = true, testId = 'ui-log-viewer' }: LogViewerProps) {
  const normalizedLines = lines.map(normalizeLine);

  return (
    <div className="log-viewer" data-testid={testId}>
      {normalizedLines.length === 0 ? (
        <p className="empty-state">No log entries captured.</p>
      ) : (
        <ol className="log-list">
          {normalizedLines.map((line, index) => (
            <li key={`${line.timestamp ?? 'line'}-${index}`}>
              <div className="log-meta">
                {showLevel && line.level ? (
                  <Badge testId={`${testId}-level`} tone={levelTone(line.level)}>
                    {line.level}
                  </Badge>
                ) : null}
                {line.timestamp ? <time dateTime={line.timestamp}>{line.timestamp}</time> : null}
              </div>
              <code>{line.message}</code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
