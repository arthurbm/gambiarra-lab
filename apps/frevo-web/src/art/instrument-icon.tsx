import type { Instrument } from "./characters";
import { ICON_SIZE, iconPixels } from "./instrument-icons";

/** A frevo instrument as crisp SVG pixels; it scales to any size. */
export function InstrumentIcon({
  className,
  instrument,
  label,
}: {
  className?: string;
  instrument: Instrument;
  label?: string;
}) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      role={label ? "img" : undefined}
      shapeRendering="crispEdges"
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
    >
      {iconPixels(instrument).map((pixel) => (
        <rect
          fill={pixel.color}
          height={1}
          key={`${pixel.x}-${pixel.y}`}
          width={1}
          x={pixel.x}
          y={pixel.y}
        />
      ))}
    </svg>
  );
}
