// The phone's line about the model that thinks for the boneco, saying so when
// another model answered because the boneco's own was busy.
import { modelLabel } from "@gambiarra-lab/frevo/models";
import type { PublicBoneco } from "@gambiarra-lab/frevo/snapshot";

type BonecoModel = Pick<
  PublicBoneco,
  "assignedModel" | "brain" | "model" | "thinking"
>;

export function modelLine(boneco: BonecoModel): string {
  const own = boneco.assignedModel ? modelLabel(boneco.assignedModel) : null;
  if (boneco.thinking) {
    return own ? `${own} está pensando…` : "Pensando…";
  }
  if (boneco.brain === "autopilot") {
    return "No piloto automático";
  }
  if (boneco.model && boneco.model !== boneco.assignedModel && own) {
    return `Quem respondeu agora: ${modelLabel(boneco.model)}, no lugar de ${own}`;
  }
  const answered = boneco.model ? modelLabel(boneco.model) : own;
  return answered ? `Quem pensa por você: ${answered}` : "";
}
