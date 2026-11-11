#!/usr/bin/env bun
// What the models write for the telão, through a real hub: per model, tap
// questions of the interview, refrains and a few lines of every other kind,
// counted for blocked words, a leaked "Pergunta 2 de 3", lines that open with
// "Oxe" and invalid answers. Every text goes to a JSON file to be read by a
// person, since nonsense ("Espetinho de espeto") has no regex.
//
//   bun scripts/frevo-text-check.ts [--questions 12] [--refrains 4] [--out file.json] [model:participants ...]
//
// The key comes from OPENROUTER_API_KEY or ~/.config/gambiarra-lab/openrouter.key.
// FREVO_REAL_CHECK_BUDGET_USD (default 0.15) stops it when the providers'
// reported cost reaches it.
import { writeFile } from "node:fs/promises";
import { decisionBody, readDecision } from "../apps/frevo/src/brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../apps/frevo/src/gambi/room";
import { modelHostConfig } from "../apps/frevo/src/model-host/config";
import { startModelHost } from "../apps/frevo/src/model-host/host";
import { startProviderProxy } from "../apps/frevo/src/model-host/provider-proxy";
import {
  DEFAULT_REAL_MODELS,
  parseModels,
} from "../apps/frevo/src/models/catalog";
import { isBlocked } from "../apps/frevo/src/sim/blocklist";
import { acceptQuestion } from "../apps/frevo/src/sim/interview";
import {
  type Acquaintance,
  type Action,
  type DecisionRequest,
  PRACA,
} from "../apps/frevo/src/sim/world";
import { startHub } from "../apps/frevo/src/testing/processes";
import { until } from "../apps/frevo/src/testing/until";

const ROOM_NAME = "frevo-text-check";
const LEAKED_NUMBER = /^\W*(pergunta\b|\d+\s*(de|\/)\s*\d+)/i;
const OXE_OPENING = /^\W*(oxe|oxente)\b/i;
const BORA_OPENING = /^\W*bora\b/i;
const INSTRUMENTS = [
  "trompete",
  "trombone",
  "saxofone",
  "tuba",
  "surdo",
  "caixa",
  "pandeiro",
  "sombrinha",
];
const FOOD = {
  question: "Qual comida do Recife tu não larga?",
  answer: "Cuscuz",
};
const SOUND = { question: "Qual som te bota pra dançar?", answer: "Maracatu" };
const PREVIOUS = [[], [FOOD], [FOOD, SOUND]];
const LIA: Acquaintance = {
  name: "Lia",
  instrument: "pandeiro",
  personality: [
    "Ama praia cedo e água de coco.",
    "Dança ciranda na beira do mar.",
  ],
};
const DOCINHO: Acquaintance = {
  name: "Docinho",
  instrument: "trompete",
  personality: [
    "Fã de bolo de rolo e brega.",
    "Sobe a ladeira de Olinda todo ano.",
  ],
};
const PE_NA_PRACA: Acquaintance[] = [
  LIA,
  DOCINHO,
  {
    name: "Bia",
    instrument: "surdo",
    personality: [
      "Curte maracatu de baque virado.",
      "Prefere a sombra do Marco Zero.",
    ],
  },
  {
    name: "Dedé",
    instrument: "tuba",
    personality: ["Não perde um caldo de cana.", "Sai no frevo até clarear."],
  },
];
const BATUQUE: Acquaintance[] = [
  {
    name: "Neném",
    instrument: "caixa",
    personality: ["Gosta de feira e de cuscuz.", "Dança coco de roda."],
  },
  {
    name: "Biu",
    instrument: "saxofone",
    personality: ["Ouve manguebeat no fone.", "Passeia no Recife Antigo."],
  },
  { name: "Naná", instrument: null, personality: null },
];

const args = process.argv.slice(2);
function flag(name: string, fallback: number): number {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : fallback;
}
const questions = flag("--questions", 12);
const refrains = flag("--refrains", 4);
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined;
const named = args.filter(
  (arg, index) => !(arg.startsWith("--") || args[index - 1]?.startsWith("--"))
);
const specs = parseModels(
  named.length > 0 ? named.join(",") : DEFAULT_REAL_MODELS
);
const budgetUsd = Number(process.env.FREVO_REAL_CHECK_BUDGET_USD || 0.15);

function requestsFor(model: string): DecisionRequest[] {
  const list: DecisionRequest[] = [];
  const base = () => ({
    id: `${model}#${list.length}`,
    boneco: { id: "boneco-1", name: "Docinho" },
    deadlineMs: 30_000,
  });
  for (let index = 0; index < questions; index += 1) {
    list.push({
      ...base(),
      kind: "question",
      index: index % 3,
      total: 3,
      previous: PREVIOUS[index % 3] ?? [],
    });
  }
  for (let index = 0; index < refrains; index += 1) {
    const even = index % 2 === 0;
    list.push({
      ...base(),
      kind: "refrao",
      blocoName: even ? "Bloco Pé na Praça" : "Batuque de Mar e Feira",
      current: null,
      people: even ? PE_NA_PRACA : BATUQUE,
    });
  }
  list.push({ ...base(), placeId: "fonte", places: PRACA.places });
  list.push({ ...base(), placeId: null, places: PRACA.places });
  list.push({
    ...base(),
    kind: "encounter",
    instrument: "trompete",
    personality: DOCINHO.personality,
    other: LIA,
  });
  list.push({
    ...base(),
    kind: "personality",
    answers: [FOOD, SOUND],
    freeText: "Moro perto da praia e amo frevo",
    instruments: INSTRUMENTS,
  });
  list.push({
    ...base(),
    kind: "nome",
    people: PE_NA_PRACA,
    taken: ["Bloco Doce Ladeira"],
  });
  list.push({
    ...base(),
    kind: "maestro",
    people: [...PE_NA_PRACA, ...BATUQUE.slice(0, 2)],
    sizes: [3, 3],
  });
  return list;
}

/** The texts of an action that reach a screen, and the raw question. */
function textsOf(action: Action): { opening: string[]; texts: string[] } {
  switch (action.type) {
    case "question":
      return {
        opening: [action.question],
        texts: [action.question, ...action.options],
      };
    case "refrao":
      return { opening: action.lines, texts: [...action.lines, action.common] };
    case "nome":
      return { opening: [], texts: [action.name] };
    case "personality":
      return {
        opening: [action.speech],
        texts: [action.summary, action.speech],
      };
    default:
      return {
        opening: "speech" in action ? [action.speech] : [],
        texts: "speech" in action ? [action.speech] : [],
      };
  }
}

interface Row {
  action?: Action;
  blocked: string[];
  bora: number;
  costUsd: number;
  kind: string;
  leaked: boolean;
  oxe: number;
  reason?: string;
  spoken: number;
}

function failed(kind: string, reason: string, costUsd = 0): Row {
  return {
    kind,
    costUsd,
    blocked: [],
    leaked: false,
    bora: 0,
    oxe: 0,
    spoken: 0,
    reason,
  };
}

/** One decision through the hub, counted for what reaches a screen. */
async function ask(participantId: string, request: DecisionRequest) {
  const body = decisionBody(request, participantId);
  const kind = request.kind ?? "walk";
  let completion: unknown;
  try {
    completion = await infer(participantId, body, AbortSignal.timeout(60_000));
  } catch (error) {
    return failed(kind, error instanceof Error ? error.message : String(error));
  }
  const reported = Number(
    (completion as { usage?: { cost?: unknown } }).usage?.cost ?? 0
  );
  const costUsd = Number.isFinite(reported) ? reported : 0;
  const read = readDecision(completion, body, request);
  if (!read.ok) {
    return failed(kind, read.reason, costUsd);
  }
  const { texts, opening } = textsOf(read.action);
  const numbered =
    read.action.type === "question" && LEAKED_NUMBER.test(read.action.question);
  const accepted =
    read.action.type === "question"
      ? acceptQuestion(read.action.question, read.action.options)
      : null;
  return {
    kind,
    costUsd,
    action: read.action,
    blocked: texts.filter((text) => isBlocked(text)),
    // Still numbered in what the phone would show, after cleaning.
    leaked: numbered && !!accepted && LEAKED_NUMBER.test(accepted.question),
    oxe: opening.filter((text) => OXE_OPENING.test(text)).length,
    bora: opening.filter((text) => BORA_OPENING.test(text)).length,
    spoken: opening.length,
    reason: numbered ? "raw question numbered" : undefined,
  };
}

let spentUsd = 0;
let infer: ReturnType<typeof roomInference> = () => {
  throw new Error("the hub is not up yet");
};
const results = new Map<string, Row[]>();
const config = await modelHostConfig({
  ...process.env,
  FREVO_MODEL_HOST_MODE: "openrouter",
  FREVO_MODELS: specs
    .map((spec) => `${spec.model}:${spec.participants}`)
    .join(","),
});
if (config.mode !== "openrouter") {
  throw new Error("the text check needs the real provider");
}
const hub = await startHub();
const proxy = startProviderProxy({
  models: specs.map((spec) => spec.model),
  upstream: config.upstream,
});
try {
  const room = await ensureRoom(hub.url, ROOM_NAME);
  const host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: config.models,
    upstream: { endpoint: proxy.endpoint },
    retryMs: 1000,
  });
  try {
    const participants = await until(async () => {
      const connected = await listModelParticipants(hub.url, room.code);
      return connected.length === host.participantIds.length
        ? connected
        : undefined;
    }, 60_000);
    infer = roomInference(hub.url, () => room.code);
    await Promise.all(
      specs.map(async (spec) => {
        const queue = requestsFor(spec.model);
        const rows: Row[] = [];
        results.set(spec.model, rows);
        const mine = participants.filter((p) => p.model === spec.model);
        // Each participant answers one at a time, as on stage.
        await Promise.all(
          mine.map(async (participant) => {
            for (;;) {
              const request = queue.shift();
              if (!request || spentUsd >= budgetUsd) {
                return;
              }
              // biome-ignore lint/performance/noAwaitInLoops: one call at a time per participant, as the hub allows.
              const row = await ask(participant.id, request);
              spentUsd += row.costUsd;
              rows.push(row);
            }
          })
        );
      })
    );
  } finally {
    await host.stop();
  }
} finally {
  proxy.stop();
  await hub.stop();
}

console.log(
  "| Modelo | Válidas | Perguntas | Refrões | Termo barrado | Prefixo bruto / após limpeza | Abre com Oxe | Abre com Bora | US$ |"
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const spec of specs) {
  const rows = results.get(spec.model) ?? [];
  const valid = rows.filter((row) => row.action);
  const count = (kind: string) =>
    valid.filter((row) => row.kind === kind).length;
  const blocked = rows.filter((row) => row.blocked.length > 0).length;
  const raw = rows.filter(
    (row) => row.reason === "raw question numbered"
  ).length;
  const leaked = rows.filter((row) => row.leaked).length;
  const oxe = rows.reduce((sum, row) => sum + row.oxe, 0);
  const bora = rows.reduce((sum, row) => sum + row.bora, 0);
  const spoken = rows.reduce((sum, row) => sum + row.spoken, 0);
  const cost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  console.log(
    `| ${spec.model} | ${valid.length}/${rows.length} | ${count("question")} | ${count("refrao")} | ${blocked} | ${raw} / ${leaked} | ${oxe}/${spoken} | ${bora}/${spoken} | ${cost.toFixed(4)} |`
  );
  for (const row of rows) {
    if (row.blocked.length > 0) {
      console.log(`    barrado: ${row.blocked.join(" | ")}`);
    }
    if (!row.action) {
      console.log(`    inválida (${row.kind}): ${row.reason?.slice(0, 140)}`);
    }
  }
}
console.log(`spent US$ ${spentUsd.toFixed(5)} (budget US$ ${budgetUsd})`);
if (outFile) {
  await writeFile(
    outFile,
    JSON.stringify(Object.fromEntries(results), null, 2)
  );
}
process.exit(0);
