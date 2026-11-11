// Phones against the world server, a real hub and a fake model: three people
// arrive, are interviewed, the host starts the dynamic (the formar phase
// opens), their bonecos meet and invite each other, the humans tap yes, and a
// bloco forms. A fourth arrives late, the host advances (the phase closes),
// and she lands in the bloco. Then the host restarts, fills the square with
// simulated people and lets the phase clock close the formar phase.
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
import type { AdminState, TelaoSnapshot } from "./views";

const ROOM_NAME = "bloco-de-frevo-formar";
const ADMIN_SECRET = "segredo-do-formar";

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
    rules: {
      speed: 400,
      restMs: 60,
      decisionTimeoutMs: 2000,
      // The fake model likes or not by a hash; meeting often makes it quick.
      meetCooldownMs: 200,
      meetRadius: 40,
      askMs: 3000,
      interviewAskMs: 3000,
      openAskMs: 3000,
      voteMs: 3000,
    },
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    host: "127.0.0.1",
    port: 0,
    bonecos: 0,
    seed: 5,
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

/** The host's route, with the secret unless told otherwise. */
function admin(route: string, body: unknown = {}, secret = true) {
  return post(`/api/admin/${route}`, body, secret);
}

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

/**
 * A person with a phone: arrives, keeps the private stream open and taps the
 * first option of every question (yes, for a bloco), skipping the open one.
 */
async function person() {
  const entered = (await (await post("/api/entrar", {})).json()) as {
    boneco: string;
    sessao: string;
  };
  const stream = await openEventStream<PrivateView>(
    `${server.url}/events/celular?sessao=${entered.sessao}`
  );
  let latest: PrivateView | null = null;
  const answered = new Set<string>();
  let open = true;
  const reading = (async () => {
    while (open) {
      // biome-ignore lint/performance/noAwaitInLoops: one event at a time.
      const view = await stream.next().catch(() => null);
      if (!view) {
        return;
      }
      latest = view;
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
    ...entered,
    view: () => latest as PrivateView | null,
    async close() {
      open = false;
      stream.close();
      await reading;
    },
  };
}

describe("forming blocos through the world server", () => {
  test("phones answer, the formar phase opens and a bloco of three forms; a late arrival joins it", async () => {
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    const people = await Promise.all([person(), person(), person()]);
    await until(
      async () =>
        people.every((one) => one.view()?.interview?.done) ? true : undefined,
      20_000
    );

    const unauthorized = await admin("iniciar", {}, false);
    expect(unauthorized.status).toBe(401);
    const opened = await admin("iniciar");
    expect(((await opened.json()) as AdminState).clock.phase).toBe("formar");

    // Every phone ends up with the other two of its bloco.
    await until(
      async () =>
        people.every((one) => one.view()?.bloco?.mates.length === 2)
          ? true
          : undefined,
      30_000
    );
    for (const one of people) {
      const view = one.view() as PrivateView;
      const others = people
        .filter((other) => other !== one)
        .map((other) => other.boneco)
        .sort();
      expect(view.bloco?.mates.map((mate) => mate.id).sort()).toEqual(others);
      expect(view.talks.length).toBeGreaterThan(0);
      expect(view.talks[0]?.with.name).toBeTruthy();
    }

    // The telão shows the bloco and the log.
    const withBloco = await telao.find(
      (snapshot) =>
        snapshot.blocos.length === 1 &&
        snapshot.bonecos.every((boneco) => boneco.bloco !== null)
    );
    expect(withBloco.blocos[0]?.members).toHaveLength(3);
    const log = withBloco.events.map((event) => event.text).join("\n");
    expect(log).toContain("Bloco 1 formado");

    // A fourth arrives; the phase closes; she goes to the only bloco.
    const late = await person();
    const closed = await admin("avancar");
    expect(((await closed.json()) as AdminState).clock.phase).toBe("compor");
    await until(
      async () => (late.view()?.bloco?.mates.length === 3 ? true : undefined),
      10_000
    );
    const final = await telao.find(
      (snapshot) =>
        snapshot.bonecos.length === 4 &&
        snapshot.bonecos.every((boneco) => boneco.bloco !== null)
    );
    expect(final.blocos).toHaveLength(1);
    expect(final.blocos[0]?.members).toHaveLength(4);

    telao.close();
    await Promise.all([...people, late].map((one) => one.close()));
  }, 60_000);

  test("after a restart, simulated people answer the invitations and the phase clock leaves everyone in a bloco", async () => {
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    expect((await admin("reiniciar")).status).toBe(200);
    // A new world: no bloco and no event from the dynamic before.
    const restarted = await telao.find(
      (snapshot) =>
        snapshot.clock.phase === "entrada" && snapshot.bonecos.length === 0
    );
    expect(restarted.blocos).toEqual([]);
    expect(restarted.events).toEqual([]);

    await admin("simulados", { total: 7 });
    await admin("duracoes", { formar: 12_000 });
    expect((await admin("iniciar")).status).toBe(200);
    const opened = await telao.find(
      (snapshot) => snapshot.clock.phase === "formar"
    );
    expect(opened.bonecos).toHaveLength(7);

    // The clock ends the phase; whoever is alone is grouped.
    const grouped = await telao.find(
      (snapshot) =>
        snapshot.clock.phase === "compor" &&
        snapshot.bonecos.every((boneco) => boneco.bloco !== null),
      30_000
    );
    expect(grouped.bonecos).toHaveLength(7);
    const members = grouped.blocos.flatMap((bloco) => bloco.members).sort();
    expect(members).toEqual(grouped.bonecos.map((boneco) => boneco.id).sort());
    telao.close();
  }, 60_000);
});
