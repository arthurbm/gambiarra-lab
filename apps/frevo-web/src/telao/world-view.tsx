// Draws one snapshot of the world. It knows nothing about the stream, so the
// art can change without touching how the data arrives.
import type {
  PublicBoneco,
  PublicSnapshot,
} from "@gambiarra-lab/frevo/snapshot";

const COLORS = [
  "#ffd23f",
  "#ee4266",
  "#3bceac",
  "#5b8def",
  "#f78c1f",
  "#b983ff",
];
const DIGITS = /\d+/;

function percent(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

function colorOf(boneco: PublicBoneco) {
  const index = Number(DIGITS.exec(boneco.id)?.[0] ?? 0);
  return COLORS[index % COLORS.length];
}

function caption(boneco: PublicBoneco) {
  if (boneco.thinking) {
    return "pensando…";
  }
  if (boneco.brain === "model") {
    return boneco.model ?? "modelo";
  }
  return boneco.brain === "autopilot" ? "no piloto automático" : "";
}

export function WorldView({ snapshot }: { snapshot: PublicSnapshot }) {
  const { map } = snapshot;
  return (
    <div
      className="world"
      style={{ aspectRatio: `${map.width} / ${map.height}` }}
    >
      {map.places.map((place) => (
        <div
          className="world-place"
          key={place.id}
          style={{
            left: percent(place.x, map.width),
            top: percent(place.y, map.height),
          }}
        >
          <span className="world-place-mark" />
          <span className="world-place-name">{place.name}</span>
        </div>
      ))}
      {snapshot.bonecos.map((boneco) => (
        <div
          className="world-boneco"
          data-facing={boneco.facing}
          data-thinking={boneco.thinking}
          data-walking={boneco.walking}
          key={boneco.id}
          style={{
            left: percent(boneco.x, map.width),
            top: percent(boneco.y, map.height),
          }}
        >
          {boneco.speech ? (
            <p className="world-balloon">{boneco.speech}</p>
          ) : null}
          {boneco.thinking ? (
            <span aria-label="pensando" className="world-thinking" role="img">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <span
            className="world-boneco-body"
            style={{ background: colorOf(boneco) }}
          />
          <span className="world-boneco-name">{boneco.name}</span>
          <span className="world-boneco-caption">{caption(boneco)}</span>
        </div>
      ))}
    </div>
  );
}
