// How the phone names the models: the one the boneco was given, and the one
// that answered when its own was busy and another took the decision.
import { modelLabel } from "@gambiarra-lab/frevo/models";
import type { PublicBoneco } from "@gambiarra-lab/frevo/snapshot";

type BonecoModel = Pick<PublicBoneco, "assignedModel" | "model">;

export function ownModelLabel(boneco: BonecoModel): string | null {
  return boneco.assignedModel ? modelLabel(boneco.assignedModel) : null;
}

/** Said only when the last answer came from a model other than the boneco's own. */
export function otherModelLine(boneco: BonecoModel): string | null {
  if (!(boneco.model && boneco.assignedModel)) {
    return null;
  }
  if (boneco.model === boneco.assignedModel) {
    return null;
  }
  return `Quem respondeu agora: ${modelLabel(boneco.model)}, no lugar de ${modelLabel(boneco.assignedModel)}`;
}
