type HealthTone = 'ok' | 'warn' | 'error' | 'loading' | 'neutral';

interface HealthDotProps {
  tone?: HealthTone;
  label?: string;
  testId?: string;
}

export default function HealthDot({ tone = 'neutral', label, testId = 'health-dot' }: HealthDotProps) {
  return (
    <span className={`health-dot health-dot-${tone}`} data-testid={testId} title={label}>
      <span className="health-dot-pip" aria-hidden="true" />
      {label ? <span className="health-dot-label">{label}</span> : null}
    </span>
  );
}
