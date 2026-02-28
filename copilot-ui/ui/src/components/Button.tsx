import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  testId?: string;
  children?: ReactNode;
}

export default function Button({
  type = 'button',
  variant = 'primary',
  size = 'md',
  testId = 'ui-button',
  children,
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      {...buttonProps}
      className={`button button-${variant} button-${size} ${buttonProps.className ?? ''}`.trim()}
      data-testid={testId}
      type={type}
    >
      {children}
    </button>
  );
}
