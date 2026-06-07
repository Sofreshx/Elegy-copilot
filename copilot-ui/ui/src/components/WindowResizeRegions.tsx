import type { DesktopWindowControls, TauriResizeDirection } from '../vite-env';

interface ResizeRegionSpec {
  readonly id: string;
  readonly direction: TauriResizeDirection;
  readonly className: string;
}

const RESIZE_REGIONS: ReadonlyArray<ResizeRegionSpec> = [
  { id: 'north-west', direction: 'NorthWest', className: 'window-resize-region window-resize-region-nw' },
  { id: 'north', direction: 'North', className: 'window-resize-region window-resize-region-n' },
  { id: 'north-east', direction: 'NorthEast', className: 'window-resize-region window-resize-region-ne' },
  { id: 'west', direction: 'West', className: 'window-resize-region window-resize-region-w' },
  { id: 'east', direction: 'East', className: 'window-resize-region window-resize-region-e' },
  { id: 'south-west', direction: 'SouthWest', className: 'window-resize-region window-resize-region-sw' },
  { id: 'south', direction: 'South', className: 'window-resize-region window-resize-region-s' },
  { id: 'south-east', direction: 'SouthEast', className: 'window-resize-region window-resize-region-se' },
];

export default function WindowResizeRegions() {
  const controls: DesktopWindowControls | null = window.instructionEngineDesktop?.windowControls ?? null;

  if (!controls) return null;

  function handlePointerDown(direction: TauriResizeDirection) {
    return (event: React.PointerEvent<HTMLDivElement>) => {
      if (!controls) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      void controls.startResizeDragging(direction);
    };
  }

  return (
    <div className="window-resize-regions" data-testid="window-resize-regions" aria-hidden="true">
      {RESIZE_REGIONS.map((region) => (
        <div
          key={region.id}
          className={region.className}
          data-testid={`window-resize-region-${region.id}`}
          data-resize-direction={region.direction}
          onPointerDown={handlePointerDown(region.direction)}
          role="presentation"
        />
      ))}
    </div>
  );
}
