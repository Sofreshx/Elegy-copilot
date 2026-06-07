import AppIcon, { type AppIconName } from './AppIcon';

interface IconButtonProps {
  icon: AppIconName;
  size?: number;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  testId?: string;
}

export default function IconButton({
  icon,
  size = 20,
  label,
  onClick,
  active = false,
  disabled = false,
  className,
  title,
  testId = 'icon-button',
}: IconButtonProps) {
  return (
    <button
      className={`icon-button${active ? ' icon-button-active' : ''} ${className ?? ''}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      data-testid={testId}
      type="button"
    >
      <AppIcon name={icon} size={size} />
    </button>
  );
}
