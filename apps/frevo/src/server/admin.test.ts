// The host's controls against the world server, a real hub and a fake model:
// nothing works without the secret, and what the host does reaches the telão
// and the phones over SSE.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import { type RunningHub, startHub } from "../testing/processes";
import { openEventStream } from "../testing/sse";
import { until } from "../testing/until";
import { startWorldServer, type WorldServer } from "./app";
import type { AdminState, PhoneEvent, TelaoSnapshot } from "./views";

const ROOM_NAME = "bloco-de-frevo-admin";
const SECRET = "segredo-do-host-para-teste";

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let server: WorldServer;

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({ models: ["fake-frevo"], latencyMs: 20 });
  server = startWorldServer({
    tickMs: 20,
    publishMs: 40,
    roomRefreshMs: 100,
    rules: { speed: 400, restMs: 60, decisionTimeoutMs: 2000 },
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    host: "127.0.0.1",
    port: 0,
    bonecos: 0,
    seed: 1,
    adminSecret: SECRET,
  });
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-frevo", participants: 2 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
  await until(async () => {
    const health = (await (await fetch(`${server.url}/health`)).json()) as {
      participants: number;
    };
    return health.participants === 2 ? true : undefined;
  });
});

afterAll(async () => {
  await host.stop();
  await server.stop();
  upstream.stop();
  await hub.stop();
});

function admin(path: string, body?: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret !== null) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return fetch(`${server.url}/api/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function state(): Promise<AdminState> {
  const response = await admin("estado");
  expect(response.status).toBe(200);
  return (await response.json()) as AdminState;
}

async function enter(sessao?: string) {
  return await fetch(`${server.url}/api/entrar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessao ? { sessao } : {}),
  });
}

function phone(sessao: string) {
  return openEventStream<PhoneEvent>(
    `${server.url}/events/celular?sessao=${encodeURIComponent(sessao)}`
  );
}

const ACTIONS: [string, unknown][] = [
  ["iniciar", {}],
  ["pausar", {}],
  ["retomar", {}],
  ["avancar", {}],
  ["duracoes", { formar: 60_000 }],
  ["reiniciar", {}],
  ["simulados", { total: 5 }],
  ["simulados/remover", {}],
  ["expulsar", { boneco: "boneco-1" }],
  ["silenciar", { boneco: "boneco-1", silenciado: true }],
];

describe("the admin", () => {
  test("without the secret, no admin route does anything", async () => {
    const before = await state();
    for (const secret of [null, "", "errado", `${SECRET}x`]) {
      for (const [path, body] of [
        ["estado", undefined],
        ["eventos", undefined],
        ...ACTIONS,
      ] as [string, unknown][]) {
        // biome-ignore lint/performance/noAwaitInLoops: one refusal at a time.
        const response = await admin(path, body, secret);
        expect(response.status).toBe(401);
      }
    }
    const after = await state();
    expect(after.clock.phase).toBe(before.clock.phase);
    expect(after.bonecos).toHaveLength(before.bonecos.length);
  });

  test("a server with no secret configured keeps the admin closed", async () => {
    const closed = startWorldServer({
      hubUrl: hub.url,
      roomName: `${ROOM_NAME}-fechado`,
      host: "127.0.0.1",
      port: 0,
      bonecos: 0,
      seed: 1,
    });
    try {
      for (const header of [undefined, "Bearer ", "Bearer undefined"]) {
        // biome-ignore lint/performance/noAwaitInLoops: one refusal at a time.
        const response = await fetch(`${closed.url}/api/admin/iniciar`, {
          method: "POST",
          headers: header ? { Authorization: header } : {},
        });
        expect(response.status).toBe(401);
      }
    } finally {
      await closed.stop();
    }
  });

  test("start, pause, durations, advance and restart reach the telão and the phone", async () => {
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    const entered = (await (await enter()).json()) as { sessao: string };
    const celular = await phone(entered.sessao);
    const inPhase = (phase: string) => (event: PhoneEvent) =>
      "clock" in event && event.clock.phase === phase;

    expect((await admin("iniciar", {})).status).toBe(200);
    const started = await telao.find((s) => s.clock.phase === "formar");
    expect(started.clock.durationMs).toBe(150_000);
    expect(started.clock.remainingMs).toBeGreaterThan(140_000);
    await celular.find(inPhase("formar"));

    await admin("pausar", {});
    await telao.find((s) => s.clock.paused);
    await celular.find((event) => "clock" in event && event.clock.paused);

    await admin("duracoes", { formar: 600_000, compor: 90_000 });
    const longer = await telao.find((s) => s.clock.durationMs === 600_000);
    expect(longer.clock.durations.compor).toBe(90_000);

    await admin("retomar", {});
    await telao.find((s) => !s.clock.paused);

    await admin("avancar", {});
    const composing = await telao.find((s) => s.clock.phase === "compor");
    expect(composing.clock.durationMs).toBe(90_000);
    await celular.find(inPhase("compor"));

    expect((await admin("reiniciar", {})).status).toBe(200);
    const restarted = await telao.find(
      (s) => s.clock.phase === "entrada" && s.bonecos.length === 0
    );
    expect(restarted.clock.durations.compor).toBe(90_000);
    // The phone learns its boneco is gone and comes back with a new one.
    await celular.find((event) => "reiniciou" in event);
    const again = (await (await enter(entered.sessao)).json()) as {
      created: boolean;
    };
    expect(again.created).toBe(true);
    celular.close();
    telao.close();
  }, 30_000);

  test("fills the square with simulated people who go through the interview, and removes them", async () => {
    await admin("reiniciar", {});
    const real = (await (await enter()).json()) as { sessao: string };
    const celular = await phone(real.sessao);
    const filled = await admin("simulados", { total: 6 });
    expect(filled.status).toBe(200);
    const filledState = await state();
    expect(filledState.people).toMatchObject({
      joined: 1,
      connected: 1,
      simulated: 5,
    });
    expect(filledState.bonecos).toHaveLength(6);
    // The simulated ones answer: their interviews end with a personality.
    await until(
      async () => {
        const current = await state();
        const done = current.bonecos.filter(
          (boneco) => boneco.simulated && boneco.instrument !== null
        );
        return done.length === 5 ? true : undefined;
      },
      30_000,
      200
    );
    await admin("simulados/remover", {});
    const removed = await state();
    expect(removed.people.simulated).toBe(0);
    expect(removed.bonecos.map((boneco) => boneco.simulated)).toEqual([false]);
    celular.close();
  }, 40_000);

  test("expelling tells the phone and keeps the person out; silencing is listed", async () => {
    await admin("reiniciar", {});
    const entered = (await (await enter()).json()) as {
      boneco: string;
      sessao: string;
    };
    const other = (await (await enter()).json()) as { boneco: string };
    const celular = await phone(entered.sessao);
    await celular.find((event) => "boneco" in event);

    expect(
      (await admin("silenciar", { boneco: other.boneco, silenciado: true }))
        .status
    ).toBe(200);
    expect(
      (await state()).bonecos.find((boneco) => boneco.id === other.boneco)
        ?.silenced
    ).toBe(true);

    expect((await admin("expulsar", { boneco: entered.boneco })).status).toBe(
      200
    );
    await celular.find((event) => "expulso" in event);
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    const snapshot = await telao.next();
    expect(snapshot.bonecos.map((boneco) => boneco.id)).toEqual([other.boneco]);
    expect((await enter(entered.sessao)).status).toBe(403);
    const reopened = await phone(entered.sessao);
    expect("expulso" in (await reopened.next())).toBe(true);
    expect((await admin("expulsar", { boneco: "ninguem" })).status).toBe(404);
    reopened.close();
    celular.close();
    telao.close();
  }, 30_000);

  test("leaving from the phone takes the boneco out without keeping the person out", async () => {
    await admin("reiniciar", {});
    const entered = (await (await enter()).json()) as {
      boneco: string;
      sessao: string;
    };
    const other = (await (await enter()).json()) as { boneco: string };
    const celular = await phone(entered.sessao);
    await celular.find((event) => "boneco" in event);

    const sair = (body: unknown) =>
      fetch(`${server.url}/api/sair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await sair({})).status).toBe(400);
    expect((await sair({ sessao: "ninguem-aqui" })).status).toBe(404);

    const left = await sair({ sessao: entered.sessao });
    expect(left.status).toBe(200);
    expect(await left.json()).toEqual({ ok: true, boneco: entered.boneco });
    await celular.find((event) => "saiu" in event);
    expect((await sair({ sessao: entered.sessao })).status).toBe(404);
    expect((await state()).bonecos.map((boneco) => boneco.id)).toEqual([
      other.boneco,
    ]);
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    expect((await telao.next()).bonecos.map((boneco) => boneco.id)).toEqual([
      other.boneco,
    ]);
    // Another tab of the same session is told so, instead of entering again.
    const reopened = await phone(entered.sessao);
    expect("saiu" in (await reopened.next())).toBe(true);

    // Not banned: the phone comes back with a new session and a new boneco.
    const back = await enter();
    expect(back.status).toBe(200);
    const again = (await back.json()) as { boneco: string; created: boolean };
    expect(again.created).toBe(true);
    expect(again.boneco).not.toBe(entered.boneco);
    // Even the old session may enter again; it gets a new boneco too.
    const same = (await (await enter(entered.sessao)).json()) as {
      boneco: string;
      created: boolean;
    };
    expect(same.created).toBe(true);
    expect(same.boneco).not.toBe(entered.boneco);
    expect((await state()).bonecos).toHaveLength(3);
    reopened.close();
    celular.close();
    telao.close();
  }, 30_000);

  test("the admin stream shows who joined and who is connected", async () => {
    await admin("reiniciar", {});
    const response = await fetch(`${server.url}/api/admin/eventos`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    response.body?.cancel();
    const entered = (await (await enter()).json()) as { sessao: string };
    const celular = await phone(entered.sessao);
    await until(async () => {
      const current = await state();
      return current.people.joined === 1 && current.people.connected === 1
        ? true
        : undefined;
    });
    celular.close();
    await until(async () =>
      (await state()).people.connected === 0 ? true : undefined
    );
  }, 20_000);
});
