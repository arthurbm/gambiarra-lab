// The compor phase through the world server, a real hub and a fake model:
// simulated people and one phone go through formar and compor; the bonecos
// propose names and refrains (balloons on the telão), the humans vote, and
// every bloco leaves the phase with a name and a refrain.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import type { PrivateView } from "../sim/world";
import { type RunningHub, startHub } from "../testing/processes";
import { openEventStream } from "../testing/sse";
import { until } from "../testing/until";
import { startWorldServer, type WorldServer } from "./app";
import type { TelaoSnapshot } from "./views";

const ROOM_NAME = "bloco-de-frevo-compor";
const ADMIN_SECRET = "segredo-do-compor";

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let server: WorldServer;
const bodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({
    models: ["fake-frevo"],
    latencyMs: 20,
    onRequest: (body) => bodies.push(body),
  });
  server = startWorldServer({
    tickMs: 20,
    publishMs: 40,
    roomRefreshMs: 100,
    rules: {
      speed: 400,
      restMs: 60,
      decisionTimeoutMs: 6000,
      meetCooldownMs: 200,
      meetRadius: 40,
      askMs: 3000,
      interviewAskMs: 3000,
      voteMs: 3000,
    },
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    host: "127.0.0.1",
    port: 0,
    bonecos: 0,
    seed: 9,
    adminSecret: ADMIN_SECRET,
  });
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-frevo", participants: 3 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
  await until(async () => {
    const health = (await (await fetch(`${server.url}/health`)).json()) as {
      participants: number;
    };
    return health.participants === 3 ? true : undefined;
  });
});

afterAll(async () => {
  await host.stop();
  await server.stop();
  upstream.stop();
  await hub.stop();
});

function post(path: string, body: unknown, withSecret = false) {
  return fetch(`${server.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withSecret ? { Authorization: `Bearer ${ADMIN_SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function admin(route: string, body: unknown = {}) {
  return post(`/api/admin/${route}`, body, true);
}

/** A phone that taps the first option of every question and keeps every view. */
async function person() {
  const entered = (await (await post("/api/entrar", {})).json()) as {
    boneco: string;
    sessao: string;
  };
  const stream = await openEventStream<PrivateView>(
    `${server.url}/events/celular?sessao=${entered.sessao}`
  );
  const views: PrivateView[] = [];
  const answered = new Set<string>();
  let open = true;
  const reading = (async () => {
    while (open) {
      // biome-ignore lint/performance/noAwaitInLoops: one event at a time.
      const view = await stream.next().catch(() => null);
      if (!view) {
        return;
      }
      views.push(view);
      const { ask } = view;
      if (ask && !answered.has(ask.id)) {
        answered.add(ask.id);
        await post("/api/responder", {
          sessao: entered.sessao,
          pergunta: ask.id,
          ...(ask.options.length > 0 ? { opcao: 0 } : { pular: true }),
        });
      }
    }
  })();
  return {
    views,
    async close() {
      open = false;
      stream.close();
      await reading;
    },
  };
}

describe("composing through the world server", () => {
  test("simulated people go through the whole compor phase and every bloco leaves with a name and a refrain", async () => {
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    const phone = await person();
    await admin("simulados", { total: 7 });
    await admin("duracoes", { formar: 8000, compor: 30_000 });
    // Everyone is done with the interview before the dynamic starts.
    await telao.find(
      (snapshot) =>
        snapshot.bonecos.length === 7 &&
        snapshot.bonecos.every((boneco) => boneco.instrument !== null),
      60_000
    );
    expect((await admin("iniciar")).status).toBe(200);

    // The proposals show up as balloons while the bloco composes.
    let balloons = 0;
    const after = await telao.find((snapshot) => {
      if (
        snapshot.clock.phase === "compor" &&
        snapshot.bonecos.some((boneco) =>
          boneco.speech?.startsWith("Que tal «")
        )
      ) {
        balloons += 1;
      }
      return snapshot.clock.phase === "desfile";
    }, 90_000);
    expect(balloons).toBeGreaterThan(0);
    expect(after.blocos.length).toBeGreaterThanOrEqual(2);
    for (const bloco of after.blocos) {
      expect(bloco.name).toBeTruthy();
      expect(bloco.refrain?.length).toBeGreaterThanOrEqual(2);
      expect(bloco.refrain?.length).toBeLessThanOrEqual(4);
    }
    // At least one name came out of a vote, and it went to the log.
    const log = after.events.map((event) => event.text).join("\n");
    expect(log).toContain("agora se chama");

    // The phone voted and saw the same count as its bloco.
    const voted = phone.views.find(
      (view) => view.compor?.voting && view.compor.yourVote === 0
    );
    expect(voted?.compor?.voters).toBeGreaterThanOrEqual(2);
    expect(voted?.compor?.votes).toBeGreaterThanOrEqual(1);

    // The refrain decision went out with its own max_tokens.
    const refrain = bodies.find((body) =>
      JSON.stringify(body.messages).includes("refrão de frevo")
    );
    expect(refrain?.max_tokens).toBe(700);

    telao.close();
    await phone.close();
  }, 180_000);
});
