interface RouteLoadingProps {
  label?: string;
}

export default function RouteLoading({ label = 'Loading view…' }: RouteLoadingProps) {
  return (
    <div className="state-message" data-testid="route-loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}
