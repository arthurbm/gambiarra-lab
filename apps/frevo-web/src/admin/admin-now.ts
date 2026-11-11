// The admin's "now" card in words: what is happening, what the host does
// next, and what needs attention before going on. Kept apart from the page so
// it is tested without a browser.
import type { AdminState } from "@gambiarra-lab/frevo/views";
import { clockText } from "../phase/phase-text";

export interface AdminNow {
  /** What the host does next. */
  text: string;
  title: string;
  /** Things to fix first, most urgent first. */
  warnings: string[];
}

function people(count: number): string {
  return count === 1 ? "1 boneco" : `${count} bonecos`;
}

function turnsAlone(state: AdminState): string {
  const { remainingMs } = state.clock;
  return remainingMs === null
    ? ""
    : ` A fase vira sozinha em ${clockText(remainingMs)}.`;
}

function phaseNow(state: AdminState): Pick<AdminNow, "text" | "title"> {
  const total = state.bonecos.length;
  switch (state.clock.phase) {
    case "entrada":
      return total === 0
        ? {
            title: "Entrada aberta: ninguém na praça ainda",
            text: "Mostre o telão: as pessoas entram pelo QR e respondem ao boneco. Inicie quando a praça tiver gente.",
          }
        : {
            title: `Entrada aberta: ${people(total)} na praça`,
            text: "Espere o pessoal terminar de entrar e responder. Depois, inicie.",
          };
    case "formar":
      return {
        title: "Os bonecos estão formando blocos",
        text: `Eles conversam e chamam as pessoas pelo celular.${turnsAlone(state)} Avance antes se os blocos já estiverem prontos.`,
      };
    case "compor":
      return {
        title: "Os blocos estão compondo",
        text: `Cada bloco vota o nome e o refrão no celular.${turnsAlone(state)}`,
      };
    case "desfile":
      return {
        title: "Desfile no telão",
        text: "Sua vez: marque até três blocos (marcar já prepara a música) e toque a música de cada um.",
      };
    default:
      return {
        title: "Tela final no telão",
        text: "Toque a música dos escolhidos. Para outra rodada, reinicie do zero lá embaixo.",
      };
  }
}

export function adminNow(state: AdminState): AdminNow {
  const warnings: string[] = [];
  if (state.clock.paused) {
    warnings.push(
      "Pausado: o relógio e as perguntas estão parados. Retome para continuar."
    );
  }
  if (state.spending?.exceeded) {
    warnings.push(
      "Teto de gasto atingido: os bonecos estão no piloto automático. Zere o gasto em “Modelos e gasto”."
    );
  }
  // Once the desfile runs, the jury's card says it, next to the music.
  if (!(state.jury.sound.enabled || state.jury.desfile)) {
    warnings.push(
      "Som do telão desligado: toque em “Ativar som” no telão antes do desfile."
    );
  }
  return { ...phaseNow(state), warnings };
}
