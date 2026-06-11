import { ChangeEvent } from 'react';

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  suffix?: string;
}

export default function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder = '',
  disabled = false,
  testId = 'ui-number-field',
  suffix,
}: NumberFieldProps) {
  const inputId = `${testId}-control`;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (raw === '' || raw === null) {
      onChange(null);
      return;
    }
    const num = Number(raw);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  return (
    <label className="form-input number-field" data-testid={testId} htmlFor={inputId}>
      <span className="form-label">{label}</span>
      <div className="number-field-row">
        <input
          data-testid={`${testId}-control`}
          disabled={disabled}
          id={inputId}
          min={min}
          max={max}
          onChange={handleChange}
          placeholder={placeholder}
          type="number"
          value={value ?? ''}
        />
        {suffix && <span className="number-field-suffix">{suffix}</span>}
      </div>
    </label>
  );
}
