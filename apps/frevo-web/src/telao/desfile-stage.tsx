// The desfile on the telão's stage: the bloco on stage with its name, its
// refrain in big letters, its members (each boneco in pixel art) and the
// models that thought for them. While a chosen bloco's music plays, that
// bloco takes the stage. In the final, every bloco, the chosen ones first,
// the models' summary and the credits.
import { type ModelPanelRow, modelLabel } from "@gambiarra-lab/frevo/models";
import type { DesfileBloco, DesfileView } from "@gambiarra-lab/frevo/views";
import type { CSSProperties } from "react";
import { BonecoSprite } from "../art/boneco-sprite";
import { CREDITS } from "../art/credits";
import { clockText } from "../phase/phase-text";
import { blocoColor } from "./bloco-mark";
import { nameSizeVw, refrainSizeVw } from "./desfile-sizes";
import { panelEntries } from "./models-panel-rows";
import "./desfile.css";

function count(value: number | string, one: string, many: string): string {
  return `${value} ${Number(value) === 1 ? one : many}`;
}

function labels(models: string[]): string {
  return models.map(modelLabel).join(", ");
}

function colorOf(bloco: DesfileBloco): CSSProperties {
  return { "--bloco": blocoColor(bloco.mark) } as CSSProperties;
}

function BlocoOnStage({
  bloco,
  heading,
  footer,
}: {
  bloco: DesfileBloco;
  footer?: string | null;
  heading: string;
}) {
  return (
    <article
      className="desfile-card"
      style={
        {
          ...colorOf(bloco),
          "--name-size": `${nameSizeVw(bloco.name)}vw`,
          "--refrain-size": `${refrainSizeVw(bloco.refrain)}vw`,
        } as CSSProperties
      }
    >
      <p className="desfile-heading">
        {heading}
        {bloco.chosen ? (
          <span className="desfile-chosen">escolhido do júri</span>
        ) : null}
      </p>
      <h2 className="desfile-name">{bloco.name}</h2>
      <blockquote className="desfile-refrain">
        {bloco.refrain.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a refrain may repeat a line.
          <p key={index}>{line}</p>
        ))}
      </blockquote>
      <ul className="desfile-members">
        {bloco.members.map((member) => (
          <li key={member.id}>
            <BonecoSprite
              instrument={member.instrument}
              look={member.look}
              scale={6}
              walking
            />
            <strong>{member.name}</strong>
            <small>{labels(member.models) || "piloto automático"}</small>
          </li>
        ))}
      </ul>
      {footer ? <p className="desfile-footer">{footer}</p> : null}
    </article>
  );
}

/**
 * Sprites are drawn in whole pixels while the final is sized in vh: a full HD
 * telão gets one step bigger, so both resolutions keep the same proportions.
 */
function finalSpriteScale(chosen: boolean): number {
  const tall = typeof window !== "undefined" && window.innerHeight >= 1000;
  return (chosen ? 3 : 2) + (tall ? 1 : 0);
}

/**
 * Up to seven blocos besides the chosen ones go in one row (ten blocos, three
 * chosen); more go in two rows of five, which fit because fewer chosen ones
 * are wider and their refrains wrap less.
 */
const OTHERS_IN_ONE_ROW = 7;
const OTHERS_MIN_COLUMNS = 4;
const OTHERS_TWO_ROW_COLUMNS = 5;

function othersColumns(count: number): number {
  return count > OTHERS_IN_ONE_ROW
    ? OTHERS_TWO_ROW_COLUMNS
    : Math.max(OTHERS_MIN_COLUMNS, count);
}

function FinalBloco({ bloco }: { bloco: DesfileBloco }) {
  return (
    <li
      className="final-bloco"
      data-chosen={bloco.chosen}
      style={colorOf(bloco)}
    >
      <div className="final-bloco-head">
        <h3>{bloco.name}</h3>
        {bloco.chosen ? (
          <span className="desfile-chosen">escolhido do júri</span>
        ) : null}
      </div>
      {bloco.chosen ? (
        <div className="final-bloco-refrain">
          {bloco.refrain.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a refrain may repeat a line.
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
      <ul className="final-bloco-members">
        {bloco.members.map((member) => (
          <li key={member.id} title={member.name}>
            <BonecoSprite
              instrument={member.instrument}
              look={member.look}
              scale={finalSpriteScale(bloco.chosen)}
            />
            <span>{member.name}</span>
          </li>
        ))}
      </ul>
      <p className="final-bloco-models">{labels(bloco.models)}</p>
    </li>
  );
}

function FinalScreen({
  desfile,
  models,
}: {
  desfile: DesfileView;
  models: ModelPanelRow[];
}) {
  const chosen = desfile.chosen.flatMap((id) => {
    const bloco = desfile.blocos.find((other) => other.id === id);
    return bloco ? [bloco] : [];
  });
  const others = desfile.blocos.filter((bloco) => !bloco.chosen);
  const entries = panelEntries(models).filter((entry) => !entry.off);
  const decisions = models.reduce((sum, row) => sum + row.decisions, 0);
  return (
    <section aria-label="Final" className="final">
      <header className="final-header">
        <h2>Fim do desfile</h2>
        <p>
          {desfile.blocos.length} blocos ·{" "}
          {desfile.blocos.reduce((sum, bloco) => sum + bloco.members.length, 0)}{" "}
          bonecos · {count(decisions, "decisão", "decisões")} de{" "}
          {count(entries.length, "modelo", "modelos")}
        </p>
      </header>
      {chosen.length > 0 ? (
        <ol
          className="final-chosen"
          style={{ "--columns": chosen.length } as CSSProperties}
        >
          {chosen.map((bloco) => (
            <FinalBloco bloco={bloco} key={bloco.id} />
          ))}
        </ol>
      ) : null}
      {others.length > 0 ? (
        <ul
          className="final-others"
          style={
            {
              "--columns": othersColumns(others.length),
            } as CSSProperties
          }
        >
          {others.map((bloco) => (
            <FinalBloco bloco={bloco} key={bloco.id} />
          ))}
        </ul>
      ) : null}
      {entries.length > 0 ? (
        <ul aria-label="Resumo dos modelos" className="final-models">
          {entries.map((entry) => (
            <li key={entry.key}>
              <strong>{entry.label}</strong>{" "}
              {count(entry.decisions, "decisão", "decisões")} · {entry.time} ·{" "}
              {count(entry.failures, "falha", "falhas")}
            </li>
          ))}
        </ul>
      ) : null}
      <footer className="final-credits">
        {CREDITS.map((credit) => (
          <p key={credit.url}>
            {credit.text} · <span>{credit.link}</span>
          </p>
        ))}
      </footer>
    </section>
  );
}

export function DesfileStage({
  desfile,
  featured,
  models,
}: {
  desfile: DesfileView;
  /** The bloco whose music plays now. */
  featured: string | null;
  models: ModelPanelRow[];
}) {
  const playing = desfile.blocos.find((bloco) => bloco.id === featured);
  if (playing) {
    return (
      <div className="desfile">
        <BlocoOnStage bloco={playing} heading="Tocando agora" />
      </div>
    );
  }
  if (desfile.phase === "final") {
    return (
      <div className="desfile desfile-final">
        <FinalScreen desfile={desfile} models={models} />
      </div>
    );
  }
  const current =
    desfile.current === null ? undefined : desfile.blocos[desfile.current];
  if (!current) {
    return (
      <div className="desfile">
        <p className="desfile-empty">Nenhum bloco para desfilar.</p>
      </div>
    );
  }
  const position = `Bloco ${(desfile.current ?? 0) + 1} de ${desfile.blocos.length}`;
  return (
    <div className="desfile">
      <BlocoOnStage
        bloco={current}
        footer={
          desfile.currentRemainingMs === null
            ? position
            : `${position} · próximo em ${clockText(desfile.currentRemainingMs)}`
        }
        heading="Desfilando agora"
      />
    </div>
  );
}

/** The tap that lets the browser play the jury's music. */
export function SoundButton({ onEnable }: { onEnable: () => void }) {
  return (
    <button className="telao-sound" onClick={onEnable} type="button">
      Ativar som
    </button>
  );
}
