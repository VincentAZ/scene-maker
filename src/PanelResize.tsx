export function PanelResize({
  label,
  controls,
  width,
  onWidth,
  min = 290,
  max = 540,
}: {
  label: string;
  controls: string;
  width: number;
  onWidth: (width: number) => void;
  min?: number;
  max?: number;
}) {
  const resize = (next: number) => onWidth(Math.max(min, Math.min(max, next)));
  return (
    <div
      className="panel-resize"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${Math.round(width)} pixels`}
      title="Drag to resize, or use the arrow keys"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(width + (event.key === "ArrowLeft" ? 20 : -20));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          resize(event.key === "Home" ? min : max);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          resize(
            event.currentTarget.parentElement!.getBoundingClientRect().right -
              event.clientX,
          );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
