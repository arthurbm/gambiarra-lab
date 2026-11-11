// The phone's "now" card: one title, one line and where to look, so a person
// who glances at the phone knows what is happening and whether it is their
// turn. Kept apart from the page so it is tested without a browser.
import type { PhoneView } from "@gambiarra-lab/frevo/views";
import { blocoLabel } from "../telao/bloco-mark";
import { roundLine } from "./compor-text";

/** Where the person should look: answer on the phone, watch the telão, or wait. */
export type Look = "celular" | "espera" | "telao";

export const LOOK_LABEL: Record<Look, string> = {
  celular: "Sua vez: responda aqui",
  telao: "Olhe o telão",
  espera: "Aguarde um instante",
};

export interface NowCard {
  look: Look;
  text: string;
  title: string;
}

const VOTE_TITLE = {
  nome: "Vote no nome do bloco",
  refrao: "Vote no refrão do bloco",
  ajuste: "O refrão fica ou muda?",
  pronto: "Vote",
} as const;

function askCard(view: PhoneView): NowCard {
  const ask = view.ask as NonNullable<PhoneView["ask"]>;
  if (ask.purpose === "voto") {
    const round = view.compor?.round ?? "nome";
    return {
      look: "celular",
      title: VOTE_TITLE[round],
      text:
        ask.textMaxLength === null
          ? "Toque no que você prefere."
          : "Toque em um nome, ou escreva outro.",
    };
  }
  if (ask.purpose === "bloco") {
    return {
      look: "celular",
      title: "Convite para um bloco",
      text: "Seu boneco achou gente parecida com você.",
    };
  }
  const { interview } = view;
  const tapsLeft = interview && interview.answered < interview.total;
  return {
    look: "celular",
    title: "Seu boneco quer te conhecer",
    text:
      interview && tapsLeft
        ? `Pergunta ${interview.answered + 1} de ${interview.total}. Toque em uma resposta.`
        : "Última pergunta: escreva se quiser, ou pule.",
  };
}

function comporCard(view: PhoneView): NowCard {
  const compor = view.compor as NonNullable<PhoneView["compor"]>;
  if (compor.round === "pronto") {
    return {
      look: "telao",
      title: "Bloco pronto!",
      text: "Nome e refrão escolhidos. Agora é esperar o desfile.",
    };
  }
  if (compor.voting) {
    return {
      look: "espera",
      title:
        compor.yourVote === null ? "O bloco está votando" : "Voto registrado!",
      text: roundLine(compor),
    };
  }
  return {
    look: "espera",
    title:
      compor.round === "nome"
        ? "Os bonecos estão pensando no nome"
        : "Os bonecos estão escrevendo o refrão",
    text: "A votação aparece aqui daqui a pouco.",
  };
}

function desfileCard(view: PhoneView): NowCard {
  const { desfile } = view;
  if (!desfile) {
    return {
      look: "telao",
      title: view.phase === "final" ? "Fim do desfile" : "Hora do desfile",
      text: "Seu boneco ficou sem bloco desta vez. Acompanhe pelo telão.",
    };
  }
  if (desfile.chosen) {
    return {
      look: "telao",
      title: "Seu bloco foi escolhido pelo júri!",
      text: "A música dele toca no telão.",
    };
  }
  if (desfile.phase === "final") {
    return {
      look: "telao",
      title: "Fim do desfile",
      text: "Seu bloco não foi escolhido desta vez. Valeu por brincar!",
    };
  }
  return desfile.onStage
    ? {
        look: "telao",
        title: "Seu bloco está no palco agora!",
        text: "Cante o refrão junto.",
      }
    : {
        look: "telao",
        title: "Hora do desfile",
        text: "Os blocos passam um por vez no telão. O seu já vem.",
      };
}

/** What the phone says at the top, from everything it knows. */
export function nowCard(view: PhoneView): NowCard {
  if (view.ask) {
    return askCard(view);
  }
  if (view.interview && !view.interview.done) {
    return {
      look: "espera",
      title: "Seu boneco está pensando",
      text:
        view.interview.answered < view.interview.total
          ? "A próxima pergunta já aparece aqui."
          : "Ele está decidindo como te vê e que instrumento toca.",
    };
  }
  if (view.phase === "desfile" || view.phase === "final") {
    return desfileCard(view);
  }
  if (view.phase === "entrada") {
    return {
      look: "telao",
      title: "Tudo pronto!",
      text: `Procure ${view.boneco.name} na praça do telão. A brincadeira começa quando o apresentador der a largada.`,
    };
  }
  if (view.phase === "compor" && view.compor) {
    return comporCard(view);
  }
  if (view.bloco) {
    return {
      look: "telao",
      title: `Você está no ${blocoLabel(view.bloco.mark)}!`,
      text: "Veja aqui embaixo quem está com você. Daqui a pouco o bloco escolhe nome e refrão.",
    };
  }
  return view.phase === "compor"
    ? {
        look: "espera",
        title: "O maestro está montando seu bloco",
        text: "Em instantes você entra em um.",
      }
    : {
        look: "telao",
        title: "Seu boneco está procurando um bloco",
        text: "Ele conversa com os outros na praça. Se achar gente parecida com você, o convite aparece aqui.",
      };
}
