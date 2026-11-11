import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import type { ModelPanelRow } from "../models/panel";
import type { PublicSnapshot } from "../sim/world";
import { type RunningHub, startHub } from "../testing/processes";
import { openEventStream } from "../testing/sse";
import { until } from "../testing/until";
import { startWorldServer, type WorldServer } from "./app";

const ROOM_NAME = "bloco-de-frevo-servidor";
const ADMIN_SECRET = "segredo-do-host";
// A fast world, so the tests see whole walks in well under a second.
const FAST = {
  tickMs: 20,
  publishMs: 40,
  roomRefreshMs: 100,
  rules: { speed: 400, restMs: 60, decisionTimeoutMs: 2000 },
};

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let server: WorldServer;
let webDist = "";
/** Chat completions the fake provider answered. */
let answered = 0;

interface Health {
  bonecos: number;
  ok: boolean;
  participants: number;
  room: string | null;
  viewers: number;
}

async function health(target: WorldServer): Promise<Health> {
  return (await (await fetch(`${target.url}/health`)).json()) as Health;
}

function firstBoneco(snapshot: PublicSnapshot) {
  const [boneco] = snapshot.bonecos;
  if (!boneco) {
    throw new Error("the snapshot has no boneco");
  }
  return boneco;
}

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({
    models: ["fake-frevo"],
    onRequest: () => {
      answered += 1;
    },
  });
  webDist = await mkdtemp(join(tmpdir(), "frevo-web-dist-"));
  await writeFile(join(webDist, "index.html"), "<!doctype html><p>telão</p>");
  await writeFile(join(webDist, "app.js"), "console.log('frevo')");
  server = startWorldServer({
    ...FAST,
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    host: "127.0.0.1",
    port: 0,
    bonecos: 1,
    seed: 1,
    webDist,
    adminSecret: ADMIN_SECRET,
  });
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-frevo", participants: 1 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
});

afterAll(async () => {
  await host.stop();
  await server.stop();
  upstream.stop();
  await hub.stop();
  await rm(webDist, { recursive: true, force: true });
});

describe("the world server", () => {
  test("creates the Room and reports its health", async () => {
    const ready = await until(async () => {
      const current = await health(server);
      return current.room && current.participants === 1 ? current : undefined;
    });
    expect(ready).toEqual({
      ok: true,
      room: ready.room,
      participants: 1,
      bonecos: 1,
      viewers: 0,
    });
  });

  test("asks no model while nobody watches, and asks again when a telão opens", async () => {
    // Requests sent before the last telão left may still be answered.
    await until(async () =>
      (await health(server)).viewers === 0 ? true : undefined
    );
    await Bun.sleep(300);
    const before = answered;
    // Several decisions' worth of world time: rest is 60 ms, walks are short.
    await Bun.sleep(1000);
    expect(answered).toBe(before);

    const stream = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      expect((await health(server)).viewers).toBe(1);
      const walking = await stream.find((snapshot) => {
        const boneco = firstBoneco(snapshot);
        return boneco.brain === "autopilot" || boneco.brain === "model";
      });
      expect(walking.bonecos).toHaveLength(1);
      await until(() => Promise.resolve(answered > before ? true : undefined));
    } finally {
      stream.close();
    }
    await until(async () =>
      (await health(server)).viewers === 0 ? true : undefined
    );
  }, 20_000);

  test("keeps the bonecos walking on autopilot while nobody watches", async () => {
    await until(async () =>
      (await health(server)).viewers === 0 ? true : undefined
    );
    // No telão: the world can only be seen through a stream, so open one and
    // look at the first snapshot, which is the world as it was while unwatched.
    await Bun.sleep(500);
    const stream = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      const first = firstBoneco(await stream.next());
      expect(first.brain).toBe("autopilot");
      expect(first.model).toBeNull();
    } finally {
      stream.close();
    }
  }, 20_000);

  test("streams the telão: a boneco walking with a line a Room model decided", async () => {
    const stream = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      expect(stream.contentType).toContain("text/event-stream");
      const first = await stream.next();
      expect(first.bonecos).toHaveLength(1);
      expect(first.map.places.length).toBeGreaterThan(0);

      const spoke = await stream.find((snapshot) => {
        const boneco = firstBoneco(snapshot);
        return boneco.brain === "model" && boneco.speech !== null;
      });
      const talking = firstBoneco(spoke);
      expect(talking.model).toBe("fake-frevo");
      expect(talking.speech?.length).toBeGreaterThan(0);

      const moved = await stream.find((snapshot) => {
        const boneco = firstBoneco(snapshot);
        return Math.hypot(boneco.x - talking.x, boneco.y - talking.y) > 5;
      });
      expect(moved.timeMs).toBeGreaterThan(spoke.timeMs);
    } finally {
      stream.close();
    }
  });

  test("gives a telão that connects again the world as it is now", async () => {
    const before = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    const last = await before.next();
    before.close();

    const again = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      const first = await again.next();
      expect(first.timeMs).toBeGreaterThanOrEqual(last.timeMs);
      expect(first.bonecos.map((boneco) => boneco.id)).toEqual(
        last.bonecos.map((boneco) => boneco.id)
      );
    } finally {
      again.close();
    }
  });

  test("serves the built web, with the page for every route", async () => {
    const script = await fetch(`${server.url}/app.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toBe("console.log('frevo')");
    for (const route of ["/", "/telao", "/admin"]) {
      // biome-ignore lint/performance/noAwaitInLoops: three small requests in order.
      const page = await fetch(`${server.url}${route}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain("telão");
    }
    const outside = await fetch(`${server.url}/..%2f..%2fpackage.json`);
    expect(await outside.text()).toContain("telão");
  });

  test("creates the Room again after the hub restarts, and models decide again", async () => {
    const previous = (await health(server)).room;
    await hub.restart();
    const recovered = await until(async () => {
      const current = await health(server);
      return current.room !== previous && current.participants === 1
        ? current
        : undefined;
    }, 30_000);
    expect(recovered.room).not.toBeNull();

    // A boneco still showing an old decision proves nothing: the provider
    // has to answer new requests that came through the new Room. Models are
    // asked only while someone watches.
    const before = answered;
    const stream = await openEventStream<PublicSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      await until(() =>
        Promise.resolve(answered > before + 2 ? true : undefined)
      );
      const decided = await stream.find(
        (snapshot) => firstBoneco(snapshot).brain === "model"
      );
      expect(firstBoneco(decided).model).toBe("fake-frevo");
    } finally {
      stream.close();
    }
  }, 60_000);
});

type TelaoSnapshot = PublicSnapshot & { models: ModelPanelRow[] };

function admin(path: string, init: RequestInit = {}, secret = ADMIN_SECRET) {
  return fetch(`${server.url}/api/admin${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
  });
}

describe("the models of the Room", () => {
  test("are listed for whoever gives bonecos a model", async () => {
    const listed = await until(async () => {
      const body = (await (await fetch(`${server.url}/api/models`)).json()) as {
        models: unknown[];
      };
      return body.models.length > 0 ? body : undefined;
    });
    expect(listed).toEqual({
      models: [
        {
          model: "fake-frevo",
          label: "fake-frevo",
          participants: 1,
          enabled: true,
        },
      ],
    });
  });

  test("show on the telão with decisions, response time and failures", async () => {
    const stream = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      const counted = await stream.find(
        (snapshot) => (snapshot.models[0]?.decisions ?? 0) > 0
      );
      expect(counted.models[0]).toMatchObject({
        model: "fake-frevo",
        label: "fake-frevo",
        enabled: true,
        failures: 0,
      });
      expect(counted.models[0]?.avgMs).toBeGreaterThanOrEqual(0);
    } finally {
      stream.close();
    }
  });

  test("are kept from anyone without the admin secret", async () => {
    expect((await fetch(`${server.url}/api/admin/models`)).status).toBe(401);
    expect((await admin("/models", {}, "outro")).status).toBe(401);
  });

  test("give the admin the spending, counted from the hub's events too", async () => {
    // The hub's event stream opens a moment after the Room is known.
    const state = await until(async () => {
      const current = (await (await admin("/models")).json()) as {
        models: (ModelPanelRow & { fromEvents: number })[];
        spending: { ceilingUsd: number; exceeded: boolean; spentUsd: number };
      };
      return (current.models[0]?.fromEvents ?? 0) > 0 ? current : undefined;
    });
    expect(state.spending.ceilingUsd).toBe(1);
    expect(state.spending.exceeded).toBe(false);
    expect(state.spending.spentUsd).toBeGreaterThan(0);
    expect(state.models[0]?.fromEvents).toBeGreaterThan(0);
  });

  test("can be switched off by the admin, and on again", async () => {
    const off = await admin("/models", {
      method: "POST",
      body: JSON.stringify({ model: "fake-frevo", enabled: false }),
    });
    expect(off.status).toBe(200);
    const stream = await openEventStream<TelaoSnapshot>(
      `${server.url}/events/telao`
    );
    try {
      const switched = await stream.find(
        (snapshot) => snapshot.models[0]?.enabled === false
      );
      expect(switched.models[0]?.model).toBe("fake-frevo");
      // With its only model off, the boneco walks on autopilot.
      await stream.find(
        (snapshot) => firstBoneco(snapshot).brain === "autopilot",
        10_000
      );
    } finally {
      stream.close();
    }
    const on = await admin("/models", {
      method: "POST",
      body: JSON.stringify({ model: "fake-frevo", enabled: true }),
    });
    expect(on.status).toBe(200);
    expect(
      ((await on.json()) as { models: ModelPanelRow[] }).models[0]?.enabled
    ).toBe(true);
  });
});

describe("the session's spending ceiling", () => {
  test("puts every boneco on autopilot and warns the admin", async () => {
    const thrifty = startWorldServer({
      ...FAST,
      hubUrl: hub.url,
      roomName: ROOM_NAME,
      host: "127.0.0.1",
      port: 0,
      bonecos: 2,
      seed: 4,
      adminSecret: ADMIN_SECRET,
      ceilingUsd: 0.000_000_1,
    });
    try {
      const warned = await until(async () => {
        const state = (await (
          await fetch(`${thrifty.url}/api/admin/models`, {
            headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
          })
        ).json()) as { spending: { exceeded: boolean } };
        return state.spending.exceeded ? state : undefined;
      }, 20_000);
      expect(warned.spending.exceeded).toBe(true);
      const stream = await openEventStream<TelaoSnapshot>(
        `${thrifty.url}/events/telao`
      );
      try {
        await stream.find(
          (snapshot) =>
            snapshot.bonecos.every((boneco) => boneco.brain === "autopilot"),
          10_000
        );
      } finally {
        stream.close();
      }
      const reset = await fetch(`${thrifty.url}/api/admin/spending/reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
      });
      expect(reset.status).toBe(200);
    } finally {
      await thrifty.stop();
    }
  }, 40_000);

  test("starts over when the admin restarts the dynamic", async () => {
    const thrifty = startWorldServer({
      ...FAST,
      hubUrl: hub.url,
      roomName: ROOM_NAME,
      host: "127.0.0.1",
      port: 0,
      bonecos: 2,
      seed: 5,
      adminSecret: ADMIN_SECRET,
      ceilingUsd: 0.000_000_1,
    });
    const asAdmin = { Authorization: `Bearer ${ADMIN_SECRET}` };
    try {
      await until(async () => {
        const state = (await (
          await fetch(`${thrifty.url}/api/admin/models`, { headers: asAdmin })
        ).json()) as { spending: { exceeded: boolean } };
        return state.spending.exceeded ? true : undefined;
      }, 20_000);
      const restarted = await fetch(`${thrifty.url}/api/admin/reiniciar`, {
        method: "POST",
        headers: asAdmin,
      });
      expect(restarted.status).toBe(200);
      const { spending } = (await restarted.json()) as {
        spending: { exceeded: boolean; spentUsd: number };
      };
      expect(spending).toMatchObject({ exceeded: false, spentUsd: 0 });
    } finally {
      await thrifty.stop();
    }
  }, 40_000);
});

describe("the world server without any model", () => {
  test("keeps the boneco walking on autopilot", async () => {
    const lonely = startWorldServer({
      ...FAST,
      rules: { ...FAST.rules, decisionTimeoutMs: 200 },
      hubUrl: hub.url,
      roomName: "bloco-sem-modelo",
      host: "127.0.0.1",
      port: 0,
      bonecos: 1,
      seed: 2,
    });
    const stream = await openEventStream<PublicSnapshot>(
      `${lonely.url}/events/telao`
    );
    try {
      const walking = await stream.find((snapshot) => {
        const boneco = firstBoneco(snapshot);
        return boneco.brain === "autopilot" && boneco.walking;
      });
      expect(firstBoneco(walking).speech).toBeNull();

      const page = await fetch(`${lonely.url}/telao`);
      expect(page.status).toBe(404);
    } finally {
      stream.close();
      await lonely.stop();
    }
  });

  test("keeps the boneco walking when the hub is not there at all", async () => {
    const offline = startWorldServer({
      ...FAST,
      rules: { ...FAST.rules, decisionTimeoutMs: 200 },
      hubUrl: "http://127.0.0.1:9",
      roomName: "bloco-sem-hub",
      host: "127.0.0.1",
      port: 0,
      bonecos: 1,
      seed: 3,
    });
    const stream = await openEventStream<PublicSnapshot>(
      `${offline.url}/events/telao`
    );
    try {
      const walking = await stream.find(
        (snapshot) => firstBoneco(snapshot).brain === "autopilot"
      );
      expect(firstBoneco(walking).walking).toBe(true);
      expect((await health(offline)).room).toBeNull();
    } finally {
      stream.close();
      await offline.stop();
    }
  });
});
