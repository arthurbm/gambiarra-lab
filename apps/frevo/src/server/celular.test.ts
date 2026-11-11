// A simulated phone against the world server, a real hub and a fake model:
// it arrives, answers the interview, reloads in the middle and resumes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import type { PrivateView, PublicSnapshot } from "../sim/world";
import { type RunningHub, startHub } from "../testing/processes";
import { openEventStream } from "../testing/sse";
import { until } from "../testing/until";
import { startWorldServer, type WorldServer } from "./app";

const ROOM_NAME = "bloco-de-frevo-celular";
const PUBLIC_URL = "https://frevo.example.test";

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
    publicUrl: PUBLIC_URL,
  });
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-frevo", participants: 1 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
  await until(async () => {
    const health = (await (await fetch(`${server.url}/health`)).json()) as {
      participants: number;
    };
    return health.participants === 1 ? true : undefined;
  });
});

afterAll(async () => {
  await host.stop();
  await server.stop();
  upstream.stop();
  await hub.stop();
});

function post(path: string, body: unknown) {
  return fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function enter(sessao?: string) {
  const response = await post("/api/entrar", sessao ? { sessao } : {});
  expect(response.status).toBe(200);
  return (await response.json()) as {
    boneco: string;
    created: boolean;
    sessao: string;
  };
}

function phone(sessao: string) {
  return openEventStream<PrivateView>(
    `${server.url}/events/celular?sessao=${encodeURIComponent(sessao)}`
  );
}

describe("a phone in the world server", () => {
  test("arrives, answers, reloads in the middle and resumes, and finishes the interview", async () => {
    const telao = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    const entered = await enter();
    expect(entered.sessao.length).toBeGreaterThan(8);
    expect(entered.created).toBe(true);

    // The boneco shows up on the telão.
    const seen = await telao.find((snapshot) =>
      snapshot.bonecos.some((boneco) => boneco.id === entered.boneco)
    );
    expect(seen.phase).toBe("entrada");

    let stream = await phone(entered.sessao);
    const first = await stream.find((view) => view.ask !== null);
    expect(first.boneco.id).toBe(entered.boneco);
    expect(first.boneco.assignedModel).toBe("fake-frevo");
    expect(first.ask?.options.length).toBeGreaterThanOrEqual(2);
    expect(first.ask?.remainingMs).toBeLessThanOrEqual(12_000);

    const answered = await post("/api/responder", {
      sessao: entered.sessao,
      pergunta: first.ask?.id,
      opcao: 1,
    });
    expect(answered.status).toBe(200);
    const second = await stream.find(
      (view) => view.ask !== null && view.ask.id !== first.ask?.id
    );
    expect(second.interview?.answered).toBe(1);

    // An answer to a question that already passed is refused.
    const stale = await post("/api/responder", {
      sessao: entered.sessao,
      pergunta: first.ask?.id,
      opcao: 0,
    });
    expect(stale.status).toBe(409);

    // Reload: the page comes back with the same session.
    stream.close();
    const again = await enter(entered.sessao);
    expect(again).toEqual({ ...entered, created: false });
    stream = await phone(entered.sessao);
    const resumed = await stream.next();
    expect(resumed.boneco.id).toBe(entered.boneco);
    expect(resumed.ask?.id).toBe(second.ask?.id);
    expect(resumed.interview?.answered).toBe(1);

    let current = resumed;
    for (let answer = 0; answer < 2; answer += 1) {
      const askId = current.ask?.id;
      // biome-ignore lint/performance/noAwaitInLoops: one question at a time.
      await post("/api/responder", {
        sessao: entered.sessao,
        pergunta: askId,
        opcao: 0,
      });
      current = await stream.find(
        (view) => view.ask !== null && view.ask.id !== askId
      );
    }
    expect(current.ask?.options).toEqual([]);
    expect(current.ask?.textMaxLength).toBe(80);

    const secret = "eu toco zabumba escondido";
    const typing = await post("/api/responder", {
      sessao: entered.sessao,
      pergunta: current.ask?.id,
      digitando: true,
    });
    expect(typing.status).toBe(200);
    await post("/api/responder", {
      sessao: entered.sessao,
      pergunta: current.ask?.id,
      texto: secret,
    });
    const done = await stream.find((view) => view.interview?.done === true);
    expect(done.boneco.personality?.length).toBeGreaterThan(0);
    expect(done.boneco.instrument).not.toBeNull();
    expect(JSON.stringify(done)).not.toContain(secret);

    const later = await telao.find(
      (snapshot) =>
        snapshot.bonecos.find((boneco) => boneco.id === entered.boneco)
          ?.instrument !== null
    );
    expect(JSON.stringify(later)).not.toContain(secret);
    stream.close();
    telao.close();
  }, 30_000);

  test("refuses an unknown session and a bad answer", async () => {
    const unknown = await fetch(
      `${server.url}/events/celular?sessao=ninguem-aqui`
    );
    expect(unknown.status).toBe(404);
    const noSession = await post("/api/responder", { pergunta: "x" });
    expect(noSession.status).toBe(400);
    const bad = await post("/api/entrar", { sessao: "../../etc" });
    expect(bad.status).toBe(400);
    const notJson = await fetch(`${server.url}/api/entrar`, {
      method: "POST",
      body: "{",
    });
    expect(notJson.status).toBe(400);
  });

  test("tells the telão the public address for the QR", async () => {
    const config = await (await fetch(`${server.url}/api/config`)).json();
    expect(config).toEqual({ publicUrl: PUBLIC_URL });
  });
});
