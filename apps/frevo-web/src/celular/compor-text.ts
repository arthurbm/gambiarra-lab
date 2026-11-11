// The words of the compor panel on the phone, kept apart so they are tested
// without a browser.
import type { ComposeView } from "@gambiarra-lab/frevo/snapshot";

const ROUND_TITLE: Record<ComposeView["round"], string> = {
  nome: "Escolhendo o nome",
  refrao: "Escolhendo o refrão",
  ajuste: "Ajustando o refrão",
  pronto: "Bloco pronto",
};

export function roundTitle(view: ComposeView): string {
  return ROUND_TITLE[view.round];
}

/** What the bloco is doing now, in one line. */
export function roundLine(view: ComposeView): string {
  if (view.round === "pronto") {
    return "Nome e refrão escolhidos. Agora é desfilar!";
  }
  if (!view.voting) {
    const what = view.round === "nome" ? "nomes" : "refrões";
    return view.proposals > 0
      ? `Os bonecos estão propondo ${what}: ${view.proposals} até agora.`
      : `Os bonecos estão pensando em ${what}…`;
  }
  return voteCount(view);
}

/** How many of the bloco voted, shown to everyone, also after voting. */
export function voteCount(view: ComposeView): string {
  if (view.voters === 0) {
    return "Ninguém do bloco vota: vale a primeira proposta.";
  }
  const people = view.voters === 1 ? "pessoa" : "pessoas";
  return `${view.votes} de ${view.voters} ${people} do bloco já votaram.`;
}
