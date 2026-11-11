// The whole dynamic through the world server, a real hub and a fake model:
// one phone and simulated people go from the entrance to the final. In the
// desfile the host moves the parade, marks three blocos (a fourth is
// refused) and plays the music of one on the telão, which reports its sound
// on. The phone sees its refrain and whether its bloco was chosen. Restarting
// goes back to the entrance with nothing of the desfile left.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import { EMBEDDED_TRACK } from "../music/generator";
import { type RunningHub, startHub } from "../testing/processes";
import { openEventStream } from "../testing/sse";
import { until } from "../testing/until";
import { startWorldServer, type WorldServer } from "./app";
import type { AdminState, PhoneView, TelaoSnapshot } from "./views";

const ROOM_NAME = "bloco-de-frevo-desfile";
const ADMIN_SECRET = "segredo-do-desfile";

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
      meetCooldownMs: 200,
      meetRadius: 40,
      askMs: 3000,
      maestroMs: 2000,
    },
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    host: "127.0.0.1",
    port: 0,
    bonecos: 0,
    seed: 11,
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

async function admin(route: string, body: unknown = {}) {
  const response = await post(`/api/admin/${route}`, body, true);
  return {
    status: response.status,
    body: (await response.json()) as AdminState & { erro?: string },
  };
}

/** A person with a phone who taps the first option of every question. */
async function person() {
  const entered = (await (await post("/api/entrar", {})).json()) as {
    boneco: string;
    sessao: string;
  };
  const stream = await openEventStream<PhoneView>(
    `${server.url}/events/celular?sessao=${entered.sessao}`
  );
  let latest: PhoneView | null = null;
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
    view: () => latest as PhoneView | null,
    async close() {
      open = false;
      stream.close();
      await reading;
    },
  };
}

describe("the desfile through the world server", () => {
  test("from the entrance to the final: the parade, the jury, the music and the restart", async () => {
    const telao = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    const phone = await person();
    await admin("simulados", { total: 12 });
    await admin("duracoes", { formar: 4000, compor: 1000, desfile: 60_000 });
    expect((await admin("iniciar")).status).toBe(200);

    // The desfile opens with the first bloco on stage.
    const parade = await telao.find(
      (snapshot) => snapshot.clock.phase === "desfile",
      40_000
    );
    expect(parade.desfile?.current).toBe(0);
    const blocos = parade.desfile?.blocos ?? [];
    expect(blocos.length).toBe(4);
    for (const bloco of blocos) {
      // The compor phase named every bloco, if only with a reserve name.
      expect(bloco.name).toBeTruthy();
      expect(bloco.refrain.length).toBeGreaterThanOrEqual(2);
      expect(bloco.members.length).toBeGreaterThan(0);
      expect(bloco.models).toEqual(["fake-frevo"]);
    }

    // The host moves the parade on and back.
    expect((await admin("desfile/proximo")).body.jury.desfile?.current).toBe(1);
    expect((await admin("desfile/anterior")).body.jury.desfile?.current).toBe(
      0
    );

    // Three blocos chosen; a fourth is refused; one is unmarked and marked.
    const ids = blocos.map((bloco) => bloco.id);
    const phoneBloco = blocos.find((bloco) =>
      bloco.members.some((member) => member.id === phone.boneco)
    );
    const chosen = [
      phoneBloco?.id as string,
      ...ids.filter((id) => id !== phoneBloco?.id).slice(0, 2),
    ];
    for (const id of chosen) {
      // biome-ignore lint/performance/noAwaitInLoops: the order of marking is the placement.
      const marked = await admin("desfile/escolher", {
        bloco: id,
        escolhido: true,
      });
      expect(marked.status).toBe(200);
    }
    const fourth = ids.find((id) => !chosen.includes(id));
    const refused = await admin("desfile/escolher", {
      bloco: fourth,
      escolhido: true,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.erro).toBe("Já há 3 blocos escolhidos.");
    await admin("desfile/escolher", { bloco: chosen[2], escolhido: false });
    const remarked = await admin("desfile/escolher", {
      bloco: chosen[2],
      escolhido: true,
    });
    expect(remarked.body.jury.desfile?.chosen).toEqual(chosen);
    // Marking prepares the music; the default is the embedded track.
    expect(remarked.body.jury.tracks[chosen[0] as string]).toEqual({
      state: "pronta",
      url: EMBEDDED_TRACK,
    });

    // The phone sees its refrain in the desfile.
    await until(
      async () => (phone.view()?.desfile?.chosen ? true : undefined),
      5000
    );
    expect(phone.view()?.desfile?.refrain.length).toBeGreaterThanOrEqual(2);

    // Playing sends the track to the telão; the telão reports its sound on.
    const silent = (await (
      await fetch(`${server.url}/api/admin/estado`, {
        headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
      })
    ).json()) as AdminState;
    expect(silent.jury.sound.enabled).toBe(false);
    const played = await admin("desfile/tocar", { bloco: chosen[1] });
    expect(played.body.jury.playing).toMatchObject({
      blocoId: chosen[1],
      url: EMBEDDED_TRACK,
    });
    const playing = await telao.find(
      (snapshot) => snapshot.audio?.blocoId === chosen[1]
    );
    expect(playing.audio?.url).toBe(EMBEDDED_TRACK);
    const reported = await post("/api/telao/som", {
      telao: "telao-teste",
      ativo: true,
      tocando: chosen[1],
    });
    expect(reported.status).toBe(200);
    const again = await admin("desfile/tocar", { bloco: chosen[1] });
    expect(again.body.jury.playing?.id).toBeGreaterThan(
      played.body.jury.playing?.id ?? 0
    );
    expect(again.body.jury.sound).toEqual({
      enabled: true,
      playing: chosen[1] as string,
    });

    // The final lists every bloco and the phone sees it was chosen.
    await admin("avancar");
    const final = await telao.find(
      (snapshot) => snapshot.clock.phase === "final"
    );
    expect(final.desfile?.blocos.map((bloco) => bloco.id)).toEqual(ids);
    expect(final.desfile?.chosen).toEqual(chosen);
    await until(
      async () => (phone.view()?.desfile?.phase === "final" ? true : undefined),
      5000
    );
    expect(phone.view()?.desfile).toMatchObject({ chosen: true, placement: 1 });

    // Restarting goes back to the entrance, without the desfile.
    const restarted = await admin("reiniciar");
    expect(restarted.body.jury).toMatchObject({
      desfile: null,
      tracks: {},
      playing: null,
    });
    const entrance = await telao.find(
      (snapshot) => snapshot.clock.phase === "entrada"
    );
    expect(entrance.desfile).toBeNull();
    expect(entrance.audio).toBeNull();
    expect(entrance.bonecos).toEqual([]);

    telao.close();
    await phone.close();
  }, 90_000);
});
