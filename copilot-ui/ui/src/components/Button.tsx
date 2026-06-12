import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  testId?: string;
  children?: ReactNode;
  /** When true, disables the button and shows loading state */
  loading?: boolean;
  /** Custom label shown when loading (defaults to showing children + "…") */
  loadingLabel?: string;
}

export default function Button({
  type = 'button',
  variant = 'primary',
  size = 'md',
  testId = 'ui-button',
  loading = false,
  loadingLabel,
  children,
  disabled,
  ...buttonProps
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const displayContent = loading
    ? (loadingLabel || <>{children}…</>)
    : children;

  return (
    <button
      {...buttonProps}
      disabled={isDisabled}
      className={`button button-${variant} button-${size} ${loading ? 'button--loading' : ''} ${buttonProps.className ?? ''}`.trim()}
      data-testid={testId}
      type={type}
    >
      {displayContent}
    </button>
  );
}
