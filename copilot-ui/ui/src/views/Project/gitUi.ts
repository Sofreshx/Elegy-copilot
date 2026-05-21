export function formatRelativeTime(ms: number | null): string {
  if (!ms || ms <= 0) return 'Never';
  const delta = Date.now() - ms;
  if (delta < 0) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatSignedCount(value: number): string {
  if (value > 0) return `+${value.toLocaleString()}`;
  return value.toLocaleString();
}

export function describeDirtyState(changedFiles: number, clean: boolean): string {
  if (clean || changedFiles === 0) return 'Clean';
  return `${changedFiles} changed`;
}
