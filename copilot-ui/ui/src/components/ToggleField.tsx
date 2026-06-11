import { ReactNode } from 'react';

interface ToggleBadge {
  text: string;
  tone?: string;
}

interface ToggleFieldProps {
  label: string;
  description?: string;
  badge?: ToggleBadge;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  testId?: string;
  children?: ReactNode;
}

export default function ToggleField({
  label,
  description,
  badge,
  checked,
  onChange,
  disabled = false,
  testId = 'ui-toggle-field',
  children,
}: ToggleFieldProps) {
  return (
    <div className="toggle-field" data-testid={testId}>
      <div className="toggle-field-info">
        <div className="toggle-field-header">
          <h4 className="toggle-field-name">{label}</h4>
          {badge && (
            <span className={`toggle-field-badge toggle-field-badge-${badge.tone || 'accent'}`}>
              {badge.text}
            </span>
          )}
        </div>
        {description && (
          <p className="toggle-field-desc">{description}</p>
        )}
        {children}
      </div>
      <div className="toggle-field-control">
        <label className="toggle-switch" data-testid={`${testId}-toggle`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
          />
          <span className="toggle-slider" />
          <span className="toggle-label">{checked ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>
    </div>
  );
}
