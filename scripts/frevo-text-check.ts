#!/usr/bin/env bun
// What the models write for the telão, through a real hub: per model, tap
// questions of the interview, refrains and a few lines of every other kind,
// counted for blocked words, a leaked "Pergunta 2 de 3", lines that open with
// "Oxe" and invalid answers. Every text goes to a JSON file to be read by a
// person, since nonsense ("Espetinho de espeto") has no regex.
//
//   bun run frevo:text-check [--questions 12] [--refrains 4] [--out file.json]
//     [--burst 20 [--concurrency 10]] [--fake] [model:participants ...]
//
// --burst N then fires N decisions per model at once at the provider proxy
// (the key and each model's request fields, without the hub's one request per
// participant), at most --concurrency open per model (default N), and counts
// failures per model under load: HTTP errors, answers without a usable tool
// call, network errors. A model that passes one at a time can fail most calls
// in a burst (OpenRouter routing it to another provider under load).
// --fake runs the same against the fake models: no key, no spending.
//
// The key comes from OPENROUTER_API_KEY or ~/.config/gambiarra-lab/openrouter.key.
// FREVO_REAL_CHECK_BUDGET_USD (default 0.15) stops it when the providers'
// reported cost reaches it, the burst included.
import { writeFile } from "node:fs/promises";
import { decisionBody, readDecision } from "../apps/frevo/src/brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../apps/frevo/src/gambi/room";
import { modelHostConfig } from "../apps/frevo/src/model-host/config";
import { startFakeUpstream } from "../apps/frevo/src/model-host/fake-upstream";
import { startModelHost } from "../apps/frevo/src/model-host/host";
import { startProviderProxy } from "../apps/frevo/src/model-host/provider-proxy";
import {
  DEFAULT_FAKE_MODELS,
  DEFAULT_REAL_MODELS,
  modelEntry,
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
const burst = flag("--burst", 0);
const concurrency = Math.max(1, flag("--concurrency", burst));
const fake = args.includes("--fake");
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined;
const WITH_VALUE = new Set([
  "--questions",
  "--refrains",
  "--out",
  "--burst",
  "--concurrency",
]);
const named = args.filter(
  (arg, index) =>
    !(arg.startsWith("--") || WITH_VALUE.has(args[index - 1] ?? ""))
);
let fallbackModels = DEFAULT_REAL_MODELS;
if (fake) {
  fallbackModels = DEFAULT_FAKE_MODELS;
}
const specs = parseModels(named.length > 0 ? named.join(",") : fallbackModels);
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

interface BurstRow {
  costUsd: number;
  kind: string;
  ms: number;
  outcome: "valid" | "invalid" | "http" | "network";
  reason: string;
}

/**
 * N decisions for one model at once, straight at the provider proxy (which
 * adds the key and the model's request fields), at most `concurrency` open.
 */
async function runBurst(model: string, endpoint: string): Promise<BurstRow[]> {
  const pool = requestsFor(model);
  const rows: BurstRow[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= burst || spentUsd >= budgetUsd) {
        return;
      }
      const request = pool[index % pool.length] as DecisionRequest;
      const body = decisionBody(request, model);
      const kind = request.kind ?? "walk";
      const started = performance.now();
      // biome-ignore lint/performance/noAwaitInLoops: each worker keeps one call open.
      const row = await fetch(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
        .then(async (response): Promise<BurstRow> => {
          const ms = performance.now() - started;
          const text = await response.text();
          if (!response.ok) {
            return {
              kind,
              ms,
              costUsd: 0,
              outcome: "http",
              reason: `HTTP ${response.status}: ${text.slice(0, 80)}`,
            };
          }
          const completion = JSON.parse(text) as { usage?: { cost?: unknown } };
          const reported = Number(completion.usage?.cost ?? 0);
          const costUsd = Number.isFinite(reported) ? reported : 0;
          const read = readDecision(completion, body, request);
          return read.ok
            ? { kind, ms, costUsd, outcome: "valid", reason: "" }
            : { kind, ms, costUsd, outcome: "invalid", reason: read.reason };
        })
        .catch(
          (error): BurstRow => ({
            kind,
            ms: performance.now() - started,
            costUsd: 0,
            outcome: "network",
            reason: error instanceof Error ? error.message : String(error),
          })
        );
      spentUsd += row.costUsd;
      rows.push(row);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, burst) }, () => worker())
  );
  return rows;
}

let spentUsd = 0;
let infer: ReturnType<typeof roomInference> = () => {
  throw new Error("the hub is not up yet");
};
const results = new Map<string, Row[]>();
const bursts = new Map<string, BurstRow[]>();
const config = await modelHostConfig({
  ...process.env,
  FREVO_MODEL_HOST_MODE: fake ? "fake" : "openrouter",
  FREVO_MODELS: specs
    .map((spec) => `${spec.model}:${spec.participants}`)
    .join(","),
});
const models = specs.map((spec) => spec.model);
const hub = await startHub();
const proxy =
  config.mode === "openrouter"
    ? startProviderProxy({ models, upstream: config.upstream })
    : startFakeUpstream({
        models,
        profiles: Object.fromEntries(
          models.map((model) => [model, modelEntry(model).fake])
        ),
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
  if (burst > 0) {
    await Promise.all(
      specs.map(async (spec) => {
        bursts.set(spec.model, await runBurst(spec.model, proxy.endpoint));
      })
    );
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
if (burst > 0) {
  console.log("");
  console.log(
    `Rajada: ${burst} decisões por modelo, até ${concurrency} abertas por modelo, direto no proxy do provider`
  );
  console.log(
    "| Modelo | Enviadas | Válidas | Sem ferramenta usável | Erro HTTP | Erro de rede | p50 | Máximo | US$ |"
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const spec of specs) {
    const rows = bursts.get(spec.model) ?? [];
    const count = (outcome: BurstRow["outcome"]) =>
      rows.filter((row) => row.outcome === outcome).length;
    const times = rows.map((row) => row.ms).sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)] ?? 0;
    const max = times.at(-1) ?? 0;
    const cost = rows.reduce((sum, row) => sum + row.costUsd, 0);
    console.log(
      `| ${spec.model} | ${rows.length} | ${count("valid")} | ${count("invalid")} | ${count("http")} | ${count("network")} | ${(p50 / 1000).toFixed(2)} s | ${(max / 1000).toFixed(2)} s | ${cost.toFixed(4)} |`
    );
    const reasons = new Map<string, number>();
    for (const row of rows) {
      if (row.outcome !== "valid") {
        const reason = row.reason.slice(0, 100);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
    for (const [reason, seen] of reasons) {
      console.log(`    ${seen}x ${reason}`);
    }
  }
}
console.log(`spent US$ ${spentUsd.toFixed(5)} (budget US$ ${budgetUsd})`);
if (outFile) {
  await writeFile(
    outFile,
    JSON.stringify(
      {
        sequential: Object.fromEntries(results),
        burst: Object.fromEntries(bursts),
      },
      null,
      2
    )
  );
}
process.exit(0);
