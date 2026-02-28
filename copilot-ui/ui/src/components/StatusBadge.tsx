import Badge from './Badge';

type BadgeTone = 'neutral' | 'brand' | 'accent' | 'success' | 'danger';

interface StatusBadgeProps {
  status?: string;
  tone?: BadgeTone | null;
  testId?: string;
}

function inferToneFromStatus(input: string): BadgeTone {
  const normalized = input.toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('ok') || normalized.includes('active')) {
    return 'success';
  }

  if (normalized.includes('warn') || normalized.includes('pending') || normalized.includes('stale')) {
    return 'accent';
  }

  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('down')) {
    return 'danger';
  }

  if (normalized.includes('running') || normalized.includes('live')) {
    return 'brand';
  }

  return 'neutral';
}

export default function StatusBadge({ status = 'unknown', tone = null, testId = 'ui-status-badge' }: StatusBadgeProps) {
  const normalizedStatus = status.trim().length > 0 ? status : 'unknown';
  const resolvedTone = tone ?? inferToneFromStatus(normalizedStatus);

  return (
    <Badge testId={testId} tone={resolvedTone}>
      {normalizedStatus}
    </Badge>
  );
}
