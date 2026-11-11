#!/usr/bin/env bun
// Load test of the Bloco de frevo: N phones over the network (real HTTP and
// SSE, from outside the server, not the admin's simulated people) play one
// whole dynamic against a given address while this script conducts the phases
// through the admin routes.
//
//   bun run frevo:load -- --url https://<mundo domain> [--phones 25]
//     [--formar 150] [--compor 150] [--desfile 180]   (seconds)
//     [--out report.md] [--no-restart] [--no-reset-spending] [--no-jury]
//
// In the desfile it marks three blocos and plays the first one's music, as the
// host does. With FAL_KEY on the server, each mark spends one of the
// process's music generations on fal.ai (about US$ 0.15 each); --no-jury skips
// the jury.
//
// The admin secret comes from FREVO_ADMIN_SECRET or from a file
// (--secret-file, default ~/.config/gambiarra-lab/admin.secret). It is never
// printed. Exit 0 when the dynamic reached the final with no errors, 1 when not.
//
// It restarts the world from zero (unless --no-restart), so never point it at
// a dynamic people are playing.
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AdminState,
  PhoneEvent,
  PhoneView,
  Spending,
  TelaoSnapshot,
} from "../apps/frevo/src/server/views";

export interface LoadOptions {
  /** Phones answer after a delay drawn in this range. */
  answerDelayMs?: [number, number];
  /** Latest an answer is sent, before the countdown ends. */
  answerMarginMs?: number;
  /** Phase durations to set before starting, in ms. */
  durations?: { compor?: number; desfile?: number; formar?: number };
  /** Mark three blocos and play one in the desfile (default true). */
  jury?: boolean;
  log?: (line: string) => void;
  phones: number;
  /** Reset the spending estimate before the run. */
  resetSpending?: boolean;
  /** Restart the world from zero before the run. */
  restart?: boolean;
  secret: string;
  /** Gives up on the whole dynamic after this long. */
  timeoutMs?: number;
  url: string;
}

export interface Stats {
  count: number;
  max: number;
  p50: number;
  p95: number;
}

export interface LoadReport {
  answers: {
    /** 409: the question passed before the answer arrived. */
    late: number;
    sent: number;
  };
  bloco: { phonesWithBloco: number; phonesWithTwoMates: number };
  blocos: { members: number; name: string | null; refrain: string[] | null }[];
  durationMs: number;
  errors: string[];
  /** The final phase reached every phone. */
  finished: boolean;
  /** Free texts the phones sent, to look for them in public lines. */
  freeTexts: string[];
  latency: {
    /** POST /api/entrar. */
    entrar: Stats;
    /** From POST /api/entrar until the boneco is on the telão's stream. */
    entrarAteTelao: Stats;
    /** Gap between two snapshots on a phone's stream. */
    intervaloSse: Stats;
    /** From sending the admin's `iniciar` until each phone sees `formar`. */
    inicioAteCelular: Stats;
    /** POST /api/responder outside the compor phase. */
    resposta: Stats;
    /** From POST /api/responder until the phone's stream no longer shows that question. */
    respostaAteSse: Stats;
    /** POST /api/responder in the compor phase. */
    voto: Stats;
  };
  phases: { atMs: number; phase: string }[];
  phones: number;
  /** Questions the phones saw, unique. */
  questions: string[];
  reconnections: number;
  /** Public lines seen on the telão, unique. */
  speeches: string[];
  spending: { after: Spending | null; before: Spending | null };
  url: string;
  votes: number;
}

const PHASES = ["entrada", "formar", "compor", "desfile", "final"] as const;
/** A stream with no byte for this long (keepalive is every 15 s) is dead. */
const SILENCE_MS = 25_000;
const RECONNECT_MS = 1000;
const FREE_TEXTS = [
  "Toco trombone na banda da escola",
  "Moro em Casa Amarela e amo bolo de rolo",
  "Danço frevo desde os sete anos",
  "Trabalho com dados e sonho com o Galo",
  "Faço cerâmica e ouço Chico Science",
  "Corro na orla de Boa Viagem cedo",
];

function stats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    p50: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(sorted.at(-1) ?? 0),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Stream {
  close: () => void;
}

const DATA_PREFIX = /^data: ?/;
const TRAILING_SLASHES = /\/+$/;
const SENTENCE_END = /[.!?…"”)]$/;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NOT_LETTERS = /[^a-z]+/;
const OXE = /^\W*oxe\b/i;

/** The `data:` payloads of complete SSE blocks, and what is left over. */
export function parseSse(pending: string): { data: string[]; rest: string } {
  const blocks = pending.split("\n\n");
  const rest = blocks.pop() ?? "";
  const data = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => DATA_PREFIX.test(line))
        .map((line) => line.replace(DATA_PREFIX, ""))
        .join("\n")
    )
    .filter(Boolean);
  return { data, rest };
}

/** Reads a stream body to the end, handing each event's parsed data on. */
async function pump(
  body: NonNullable<Response["body"]>,
  onEvent: (data: unknown) => void,
  onBytes: () => void
) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: one chunk at a time.
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    onBytes();
    const parsed = parseSse(pending + value);
    pending = parsed.rest;
    for (const data of parsed.data) {
      onEvent(JSON.parse(data));
    }
  }
}

/**
 * Keeps an SSE stream open, reconnecting when it ends, fails or goes silent.
 * `onEvent` gets each parsed `data:`; `onReconnect` each new connection after
 * the first.
 */
function keepStream(input: {
  headers?: Record<string, string>;
  onError: (message: string) => void;
  onEvent: (data: unknown) => void;
  onReconnect: () => void;
  url: string;
}): Stream {
  let closed = false;
  let current: AbortController | undefined;

  async function once(): Promise<void> {
    const abort = new AbortController();
    current = abort;
    let lastByte = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastByte > SILENCE_MS) {
        abort.abort();
      }
    }, 1000);
    try {
      const response = await fetch(input.url, {
        headers: { Accept: "text/event-stream", ...input.headers },
        signal: abort.signal,
      });
      if (!(response.ok && response.body)) {
        input.onError(
          `${new URL(input.url).pathname} answered ${response.status}`
        );
        return;
      }
      await pump(response.body, input.onEvent, () => {
        lastByte = Date.now();
      });
    } catch (error) {
      if (!(closed || abort.signal.aborted)) {
        input.onError(
          `${new URL(input.url).pathname}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      clearInterval(watchdog);
    }
  }

  (async () => {
    let first = true;
    while (!closed) {
      if (!first) {
        input.onReconnect();
      }
      first = false;
      // biome-ignore lint/performance/noAwaitInLoops: reconnects one after the other.
      await once();
      if (!closed) {
        await sleep(RECONNECT_MS);
      }
    }
  })();

  return {
    close() {
      closed = true;
      current?.abort();
    },
  };
}

interface Phone {
  bonecoId: string;
  enteredAt: number;
  handled: Set<string>;
  lastSnapshotAt: number | null;
  /** Question id → when the answer was posted, until the stream drops it. */
  pendingConfirm: Map<string, number>;
  phasesSeen: Map<string, number>;
  sessao: string;
  stream?: Stream;
  view: PhoneView | null;
}

export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const log = options.log ?? (() => undefined);
  const base = options.url.replace(TRAILING_SLASHES, "");
  const auth = { Authorization: `Bearer ${options.secret}` };
  const [minDelay, maxDelay] = options.answerDelayMs ?? [800, 5000];
  const margin = options.answerMarginMs ?? 600;
  const startedAt = Date.now();
  const errors: string[] = [];
  const samples = {
    entrar: [] as number[],
    entrarAteTelao: [] as number[],
    intervaloSse: [] as number[],
    inicioAteCelular: [] as number[],
    resposta: [] as number[],
    respostaAteSse: [] as number[],
    voto: [] as number[],
  };
  const questions = new Set<string>();
  const speeches = new Set<string>();
  const freeTexts: string[] = [];
  const phases: { atMs: number; phase: string }[] = [];
  let reconnections = 0;
  let sent = 0;
  let late = 0;
  let votes = 0;
  let lastTelao: TelaoSnapshot | null = null;
  let iniciarAt: number | null = null;
  const phones: Phone[] = [];
  const byBoneco = new Map<string, Phone>();
  const onTelao = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function error(message: string) {
    errors.push(`${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`);
    log(`erro: ${message}`);
  }

  async function admin(route: string, body?: unknown): Promise<AdminState> {
    const response = await fetch(`${base}/api/admin/${route}`, {
      method: body === undefined && route === "estado" ? "GET" : "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body:
        body === undefined && route === "estado"
          ? undefined
          : JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      throw new Error(`admin ${route} answered ${response.status}`);
    }
    return (await response.json()) as AdminState;
  }

  async function spending(): Promise<Spending | null> {
    const response = await fetch(`${base}/api/admin/models`, { headers: auth });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { spending: Spending | null };
    return body.spending;
  }

  function onTelaoSnapshot(snapshot: TelaoSnapshot) {
    lastTelao = snapshot;
    const now = Date.now();
    if (phases.at(-1)?.phase !== snapshot.phase) {
      phases.push({ phase: snapshot.phase, atMs: now - startedAt });
      log(`fase ${snapshot.phase}`);
    }
    for (const boneco of snapshot.bonecos) {
      if (boneco.speech) {
        speeches.add(boneco.speech);
      }
      if (!onTelao.has(boneco.id)) {
        onTelao.add(boneco.id);
        const phone = byBoneco.get(boneco.id);
        if (phone) {
          samples.entrarAteTelao.push(now - phone.enteredAt);
        }
      }
    }
  }

  function answer(phone: Phone, ask: NonNullable<PhoneView["ask"]>) {
    const kind = phone.view?.phase === "compor" ? "voto" : "resposta";
    const body: Record<string, unknown> = {
      sessao: phone.sessao,
      pergunta: ask.id,
    };
    if (ask.options.length > 0) {
      body.opcao = Math.floor(Math.random() * ask.options.length);
    } else if (Math.random() < 0.6) {
      const text = FREE_TEXTS[Math.floor(Math.random() * FREE_TEXTS.length)];
      body.texto = text;
      freeTexts.push(text as string);
    } else {
      body.pular = true;
    }
    const sentAt = Date.now();
    sent += 1;
    if (kind === "voto") {
      votes += 1;
    }
    phone.pendingConfirm.set(ask.id, sentAt);
    fetch(`${base}/api/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((response) => {
        samples[kind].push(Date.now() - sentAt);
        if (response.status === 409) {
          late += 1;
          phone.pendingConfirm.delete(ask.id);
        } else if (!response.ok) {
          error(`responder answered ${response.status} (${phone.bonecoId})`);
        }
      })
      .catch((cause) => {
        error(`responder: ${cause instanceof Error ? cause.message : cause}`);
      });
  }

  function onPhoneEvent(phone: Phone, event: PhoneEvent) {
    const now = Date.now();
    if ("expulso" in event || "reiniciou" in event) {
      error(`${phone.bonecoId} got ${JSON.stringify(event)}`);
      return;
    }
    if (phone.lastSnapshotAt !== null) {
      samples.intervaloSse.push(now - phone.lastSnapshotAt);
    }
    phone.lastSnapshotAt = now;
    phone.view = event;
    if (!phone.phasesSeen.has(event.phase)) {
      phone.phasesSeen.set(event.phase, now);
      if (event.phase === "formar" && iniciarAt !== null) {
        samples.inicioAteCelular.push(now - iniciarAt);
      }
    }
    for (const [askId, at] of phone.pendingConfirm) {
      if (event.ask?.id !== askId) {
        samples.respostaAteSse.push(now - at);
        phone.pendingConfirm.delete(askId);
      }
    }
    if (event.ask && !phone.handled.has(event.ask.id)) {
      scheduleAnswer(phone, event.ask);
    }
  }

  function scheduleAnswer(phone: Phone, ask: NonNullable<PhoneView["ask"]>) {
    phone.handled.add(ask.id);
    questions.add(
      ask.options.length > 0
        ? `${ask.question} [${ask.options.join(" | ")}]`
        : `${ask.question} [texto livre]`
    );
    const latest = Math.max(0, ask.remainingMs - margin);
    const delay = Math.min(
      latest,
      minDelay + Math.random() * (maxDelay - minDelay)
    );
    const timer = setTimeout(() => {
      timers.delete(timer);
      answer(phone, ask);
    }, delay);
    timers.add(timer);
  }

  async function enter(): Promise<Phone | null> {
    const at = Date.now();
    try {
      const response = await fetch(`${base}/api/entrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      samples.entrar.push(Date.now() - at);
      if (!response.ok) {
        error(`entrar answered ${response.status}`);
        return null;
      }
      const body = (await response.json()) as {
        boneco: string;
        sessao: string;
      };
      const phone: Phone = {
        sessao: body.sessao,
        bonecoId: body.boneco,
        enteredAt: at,
        handled: new Set(),
        pendingConfirm: new Map(),
        phasesSeen: new Map(),
        lastSnapshotAt: null,
        view: null,
      };
      byBoneco.set(phone.bonecoId, phone);
      if (onTelao.has(phone.bonecoId)) {
        samples.entrarAteTelao.push(Date.now() - at);
      }
      phone.stream = keepStream({
        url: `${base}/events/celular?sessao=${encodeURIComponent(phone.sessao)}`,
        onEvent: (data) => onPhoneEvent(phone, data as PhoneEvent),
        onError: error,
        onReconnect: () => {
          reconnections += 1;
        },
      });
      return phone;
    } catch (cause) {
      error(`entrar: ${cause instanceof Error ? cause.message : cause}`);
      return null;
    }
  }

  async function waitFor(check: () => boolean, ms: number, what: string) {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}`);
      }
      // biome-ignore lint/performance/noAwaitInLoops: polling a condition.
      await sleep(250);
    }
  }

  const telao = keepStream({
    url: `${base}/events/telao`,
    onEvent: (data) => onTelaoSnapshot(data as TelaoSnapshot),
    onError: error,
    onReconnect: () => {
      reconnections += 1;
    },
  });

  let before: Spending | null = null;
  let after: Spending | null = null;
  let finished = false;

  async function prepare() {
    if (options.restart !== false) {
      await admin("reiniciar");
      log("mundo reiniciado do zero");
    }
    if (options.resetSpending !== false) {
      const response = await fetch(`${base}/api/admin/spending/reset`, {
        method: "POST",
        headers: auth,
      });
      if (!response.ok) {
        error(`spending/reset answered ${response.status}`);
      }
    }
    before = await spending();
    if (options.durations) {
      await admin("duracoes", options.durations);
    }
    await waitFor(() => lastTelao?.phase === "entrada", 15_000, "entrada");
  }

  async function arrive() {
    // People arrive over a few seconds, as from a QR.
    const arrivals = await Promise.all(
      Array.from({ length: options.phones }, async (_, index) => {
        await sleep(index * 150);
        return enter();
      })
    );
    phones.push(...arrivals.filter((phone) => phone !== null));
    log(`${phones.length} celulares entraram`);
    await waitFor(
      () => phones.every((phone) => phone.view !== null),
      20_000,
      "every phone's first snapshot"
    );
    // The interview: three tap questions and an open one.
    await waitFor(
      () => phones.every((phone) => phone.view?.interview?.done === true),
      120_000,
      "every interview"
    ).catch((cause) => error(String(cause)));
    const state = await admin("estado");
    log(
      `admin: ${state.people.joined} pessoas, ${state.people.connected} conectadas`
    );
    if (state.people.connected < phones.length) {
      error(
        `admin counts ${state.people.connected} connected of ${phones.length}`
      );
    }
  }

  async function conduct() {
    // Taken before the request: the server pushes the new phase to the phones
    // before it answers the admin.
    iniciarAt = Date.now();
    await admin("iniciar");
    const timeout = options.timeoutMs ?? 20 * 60_000;
    await waitFor(() => lastTelao?.phase === "compor", timeout, "compor");
    await waitFor(() => lastTelao?.phase === "desfile", timeout, "desfile");
    // The jury: three blocos marked and one music played.
    const blocos =
      options.jury === false ? [] : (lastTelao?.desfile?.blocos ?? []);
    for (const bloco of blocos.slice(0, 3)) {
      // biome-ignore lint/performance/noAwaitInLoops: the host marks one at a time.
      await admin("desfile/escolher", { bloco: bloco.id, escolhido: true });
    }
    if (blocos[0]) {
      await admin("desfile/tocar", { bloco: blocos[0].id });
    }
    await waitFor(() => lastTelao?.phase === "final", timeout, "final");
    await waitFor(
      () => phones.every((phone) => phone.phasesSeen.has("final")),
      15_000,
      "final on every phone"
    );
  }

  try {
    await prepare();
    await arrive();
    await conduct();
    finished = true;
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
  } finally {
    after = await spending().catch(() => null);
    for (const timer of timers) {
      clearTimeout(timer);
    }
    telao.close();
    for (const phone of phones) {
      phone.stream?.close();
    }
  }

  const finalBlocos: LoadReport["blocos"] = (
    (lastTelao as TelaoSnapshot | null)?.blocos ?? []
  ).map((bloco) => {
    const extra = bloco as { name?: string | null; refrain?: string[] | null };
    return {
      members: bloco.members.length,
      name: extra.name ?? null,
      refrain: extra.refrain ?? null,
    };
  });
  return {
    url: base,
    phones: phones.length,
    durationMs: Date.now() - startedAt,
    finished,
    errors,
    phases,
    reconnections,
    answers: { sent, late },
    votes,
    latency: {
      entrar: stats(samples.entrar),
      entrarAteTelao: stats(samples.entrarAteTelao),
      inicioAteCelular: stats(samples.inicioAteCelular),
      resposta: stats(samples.resposta),
      voto: stats(samples.voto),
      respostaAteSse: stats(samples.respostaAteSse),
      intervaloSse: stats(samples.intervaloSse),
    },
    bloco: {
      phonesWithBloco: phones.filter((phone) => phone.view?.bloco).length,
      phonesWithTwoMates: phones.filter(
        (phone) => (phone.view?.bloco?.mates.length ?? 0) >= 2
      ).length,
    },
    blocos: finalBlocos,
    spending: { before, after },
    questions: [...questions],
    speeches: [...speeches],
    freeTexts: [...new Set(freeTexts)],
  };
}

const STOPWORDS = new Set(
  "a o e de da do das dos em no na nos nas um uma com que se por para eu meu minha sou desde cedo".split(
    " "
  )
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .split(NOT_LETTERS)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

/**
 * Public lines sharing two or more content words with a free text, leaving
 * out the words of the tap questions (they offer "bolo de rolo" too).
 */
export function possibleParaphrases(report: LoadReport) {
  const found: { speech: string; text: string }[] = [];
  const offered = new Set(report.questions.flatMap(words));
  for (const text of report.freeTexts) {
    const own = new Set(words(text).filter((word) => !offered.has(word)));
    for (const speech of report.speeches) {
      const shared = words(speech).filter((word) => own.has(word));
      if (new Set(shared).size >= 2) {
        found.push({ text, speech });
      }
    }
  }
  return found;
}

/** Lines that look cut at the length limit in the middle of a sentence. */
export function cutSpeeches(report: LoadReport, limit = 140) {
  return report.speeches.filter(
    (speech) => speech.length >= limit - 2 && !SENTENCE_END.test(speech.trim())
  );
}

function row(name: string, value: Stats) {
  return `| ${name} | ${value.count} | ${value.p50} | ${value.p95} | ${value.max} |`;
}

export function formatReport(report: LoadReport): string {
  const usd = (value: Spending | null) =>
    value ? `US$ ${value.spentUsd.toFixed(4)} (teto ${value.ceilingUsd})` : "?";
  const paraphrases = possibleParaphrases(report);
  const cut = cutSpeeches(report);
  return [
    "# Carga: celulares simulados pela rede",
    "",
    `- Endereço: ${report.url}`,
    `- Celulares: ${report.phones}`,
    `- Chegou ao final em todos os celulares: ${report.finished ? "sim" : "NÃO"}`,
    `- Duração: ${(report.durationMs / 1000).toFixed(0)} s`,
    `- Erros: ${report.errors.length}`,
    `- Reconexões de SSE: ${report.reconnections}`,
    `- Respostas enviadas: ${report.answers.sent} (votos: ${report.votes}; chegaram depois do prazo, 409: ${report.answers.late})`,
    `- Celulares com bloco no fim: ${report.bloco.phonesWithBloco}; com os outros dois do bloco: ${report.bloco.phonesWithTwoMates}`,
    `- Gasto estimado pelo servidor: antes ${usd(report.spending.before)}, depois ${usd(report.spending.after)}`,
    "",
    "## Fases (segundos desde o início)",
    "",
    ...report.phases.map(
      (phase) => `- ${phase.phase}: ${(phase.atMs / 1000).toFixed(1)}`
    ),
    "",
    "## Latências (ms)",
    "",
    "| Medida | n | p50 | p95 | máx |",
    "|---|---|---|---|---|",
    row("entrar (POST /api/entrar)", report.latency.entrar),
    row("entrar até o boneco no telão", report.latency.entrarAteTelao),
    row(
      "iniciar no admin até o celular ver formar",
      report.latency.inicioAteCelular
    ),
    row("resposta (POST /api/responder)", report.latency.resposta),
    row("voto (POST /api/responder no compor)", report.latency.voto),
    row("resposta até sumir do SSE do celular", report.latency.respostaAteSse),
    row("intervalo entre snapshots no celular", report.latency.intervaloSse),
    "",
    "## Blocos no fim",
    "",
    ...report.blocos.map(
      (bloco) =>
        `- ${bloco.name ?? "(sem nome)"} (${bloco.members}): ${(bloco.refrain ?? []).join(" / ")}`
    ),
    "",
    "## Erros",
    "",
    ...(report.errors.length > 0
      ? report.errors.map((line) => `- ${line}`)
      : ["Nenhum."]),
    "",
    "## Qualidade do texto",
    "",
    `Falas públicas distintas: ${report.speeches.length}. Com cara de cortadas no limite (140 caracteres, sem pontuação final): ${cut.length}.`,
    "",
    ...cut.map((speech) => `- ${speech}`),
    "",
    `Falas que abrem com "Oxe": ${report.speeches.filter((speech) => OXE.test(speech)).length}.`,
    "",
    `Falas que repetem duas ou mais palavras de um texto livre (possível paráfrase): ${paraphrases.length}.`,
    "",
    ...paraphrases.map((item) => `- "${item.text}" → ${item.speech}`),
    "",
    "### Perguntas vistas nos celulares",
    "",
    ...report.questions.map((question) => `- ${question}`),
    "",
    "### Falas públicas (amostra de 40)",
    "",
    ...report.speeches.slice(0, 40).map((speech) => `- ${speech}`),
    "",
  ].join("\n");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function seconds(name: string): number | undefined {
  const raw = argument(name);
  return raw === undefined ? undefined : Number(raw) * 1000;
}

async function readSecret(): Promise<string> {
  const fromEnv = process.env.FREVO_ADMIN_SECRET?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const file =
    argument("secret-file") ??
    join(homedir(), ".config", "gambiarra-lab", "admin.secret");
  return (await readFile(file, "utf8")).trim();
}

if (import.meta.main) {
  const url = argument("url");
  if (!url) {
    process.stderr.write(
      "usage: bun run frevo:load -- --url <world address> [--phones 25] [--formar s] [--compor s] [--desfile s] [--out file.md]\n"
    );
    process.exit(2);
  }
  const durations = {
    formar: seconds("formar"),
    compor: seconds("compor"),
    desfile: seconds("desfile"),
  };
  const report = await runLoad({
    url,
    secret: await readSecret(),
    phones: Number(argument("phones") ?? 25),
    durations: Object.values(durations).some((value) => value !== undefined)
      ? durations
      : undefined,
    restart: !process.argv.includes("--no-restart"),
    jury: !process.argv.includes("--no-jury"),
    resetSpending: !process.argv.includes("--no-reset-spending"),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const markdown = formatReport(report);
  const out = argument("out");
  if (out) {
    await writeFile(out, markdown);
    process.stdout.write(`relatório em ${out}\n`);
  } else {
    process.stdout.write(`${markdown}\n`);
  }
  process.exit(report.finished && report.errors.length === 0 ? 0 : 1);
}

export { PHASES };
