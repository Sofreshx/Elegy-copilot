import { ChangeEvent } from 'react';

type InputType = 'text' | 'search' | 'email' | 'password' | 'number' | 'url' | 'tel';

interface FormInputProps {
  label?: string;
  value?: string;
  type?: InputType;
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  testId?: string;
  onValueChange?: (value: string) => void;
}

export default function FormInput({
  label = 'Field',
  value = '',
  type = 'text',
  placeholder = '',
  name = '',
  required = false,
  disabled = false,
  id = '',
  testId = 'ui-form-input',
  onValueChange,
}: FormInputProps) {
  const inputId = id || `${testId}-control`;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onValueChange?.(event.target.value);
  };

  return (
    <label className="form-input" data-testid={testId} htmlFor={inputId}>
      <span className="form-label">{label}</span>
      <input
        data-testid={`${testId}-control`}
        disabled={disabled}
        id={inputId}
        name={name || undefined}
        onChange={handleChange}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}
