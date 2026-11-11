import { useTelao } from "../telao/use-telao";
import { modelLine } from "./model-line";

/** `?boneco=<id>` follows one boneco until the entrance gives each phone its own. */
function followedBoneco() {
  return new URLSearchParams(window.location.search).get("boneco");
}

// The phone. The entrance and the interview arrive with the next tickets.
export function CelularPage() {
  const { snapshot } = useTelao();
  const id = followedBoneco();
  const boneco = snapshot?.bonecos.find((entry) => entry.id === id);
  const line = boneco ? modelLine(boneco) : "";
  return (
    <main className="placeholder">
      <h1>Bloco de frevo</h1>
      {boneco ? (
        <>
          <p>{boneco.name}</p>
          {line ? <p className="celular-model">{line}</p> : null}
        </>
      ) : (
        <p>Já, já você ganha um boneco por aqui.</p>
      )}
      <p>
        Por enquanto, veja a praça no <a href="/telao">telão</a>.
      </p>
    </main>
  );
}
