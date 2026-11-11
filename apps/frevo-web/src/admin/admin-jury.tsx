// The jury, on the host's phone: the bloco on stage with previous and next,
// marking and unmarking up to three blocos, and playing (and playing again)
// each chosen bloco's music on the telão, with the telão's sound shown.
import type { AdminState } from "@gambiarra-lab/frevo/views";
import type { CSSProperties } from "react";
import { clockText } from "../phase/phase-text";
import { blocoColor } from "../telao/bloco-mark";
import { trackText } from "./track-text";

type Act = (route: string, body?: Record<string, unknown>) => Promise<boolean>;

function SoundLine({ jury }: { jury: AdminState["jury"] }) {
  const { generations } = jury;
  return (
    <>
      <p className="admin-sound" data-on={jury.sound.enabled}>
        {jury.sound.enabled
          ? "Som do telão: ativado"
          : "Som do telão: desativado. Toque em “Ativar som” no telão."}
      </p>
      <p className="admin-hint">
        {generations
          ? `Música gerada no fal.ai: restam ${Math.max(0, generations.max - generations.used)} de ${generations.max} ${generations.max === 1 ? "geração" : "gerações"}.`
          : "Música gerada desligada (sem FAL_KEY): os escolhidos tocam a faixa de reserva."}
      </p>
    </>
  );
}

export function AdminJury({ state, act }: { act: Act; state: AdminState }) {
  const { jury } = state;
  const { desfile } = jury;
  if (!desfile) {
    return (
      <section className="admin-card">
        <h2>Júri</h2>
        <p className="admin-hint">
          O júri começa no desfile: lá você marca até três blocos e toca a
          música de cada um no telão.
        </p>
        <SoundLine jury={jury} />
      </section>
    );
  }
  const current =
    desfile.current === null ? null : desfile.blocos[desfile.current];
  const full = desfile.chosen.length >= desfile.maxChosen;
  const playingId = jury.playing?.url ? jury.playing.blocoId : null;
  return (
    <section className="admin-card admin-jury">
      <h2>
        Júri: {desfile.chosen.length} de {desfile.maxChosen} escolhidos
      </h2>
      <SoundLine jury={jury} />
      {desfile.phase === "desfile" ? (
        <div className="admin-jury-stage">
          <p>
            No telão: <strong>{current ? current.name : "nenhum bloco"}</strong>
            {current && desfile.currentRemainingMs !== null ? (
              <small>
                {" "}
                · {(desfile.current ?? 0) + 1} de {desfile.blocos.length} ·
                próximo em {clockText(desfile.currentRemainingMs)}
              </small>
            ) : null}
          </p>
          <div className="admin-main-buttons">
            <button
              disabled={!current || desfile.current === 0}
              onClick={() => act("desfile/anterior")}
              type="button"
            >
              ← Anterior
            </button>
            <button
              disabled={
                !current || desfile.current === desfile.blocos.length - 1
              }
              onClick={() => act("desfile/proximo")}
              type="button"
            >
              Próximo →
            </button>
          </div>
        </div>
      ) : (
        <p className="admin-hint">Tela final no telão.</p>
      )}
      <ul className="admin-jury-blocos">
        {desfile.blocos.map((bloco, index) => {
          const track = jury.tracks[bloco.id];
          const playing = playingId === bloco.id && jury.sound.playing !== null;
          return (
            <li
              data-chosen={bloco.chosen}
              data-current={desfile.current === index}
              key={bloco.id}
              style={{ "--bloco": blocoColor(bloco.mark) } as CSSProperties}
            >
              <div className="admin-jury-name">
                <strong>{bloco.name}</strong>
                <small>
                  {[
                    `${bloco.members.length} bonecos`,
                    desfile.current === index ? "no telão" : null,
                    bloco.chosen ? "escolhido" : null,
                    bloco.chosen && track ? trackText(track) : null,
                    playing ? "tocando" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {bloco.chosen && track?.reason ? (
                  <small className="admin-jury-reason">
                    Motivo: {track.reason}
                  </small>
                ) : null}
              </div>
              <div className="admin-jury-actions">
                {bloco.chosen ? (
                  <>
                    <button
                      className="admin-primary"
                      onClick={() => act("desfile/tocar", { bloco: bloco.id })}
                      type="button"
                    >
                      {playingId === bloco.id ? "Repetir" : "Tocar"}
                    </button>
                    <button
                      onClick={() =>
                        act("desfile/escolher", {
                          bloco: bloco.id,
                          escolhido: false,
                        })
                      }
                      type="button"
                    >
                      Desmarcar
                    </button>
                  </>
                ) : (
                  <button
                    disabled={full}
                    onClick={() =>
                      act("desfile/escolher", {
                        bloco: bloco.id,
                        escolhido: true,
                      })
                    }
                    type="button"
                  >
                    Marcar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {playingId ? (
        <button onClick={() => act("desfile/parar")} type="button">
          Parar a música
        </button>
      ) : null}
    </section>
  );
}
