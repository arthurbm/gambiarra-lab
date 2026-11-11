// What a public world server holds back: the square's ceiling of bonecos,
// for people and for the admin's simulated ones. No hub: nothing here needs a
// model.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startWorldServer, type WorldServer } from "./app";
import type { AdminState } from "./views";

const SECRET = "segredo-dos-limites";

let server: WorldServer;

beforeAll(() => {
  server = startWorldServer({
    tickMs: 20,
    publishMs: 40,
    rules: { maxBonecos: 3 },
    hubUrl: "http://127.0.0.1:9",
    roomName: "bloco-dos-limites",
    host: "127.0.0.1",
    port: 0,
    bonecos: 0,
    seed: 1,
    adminSecret: SECRET,
  });
});

afterAll(async () => {
  await server.stop();
});

function post(path: string, body: unknown, secret?: string) {
  return fetch(`${server.url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function enter(sessao?: string) {
  return await post("/api/entrar", sessao ? { sessao } : {});
}

async function admin(path: string, body: unknown = {}) {
  const response = await post(`/api/admin/${path}`, body, SECRET);
  expect(response.status).toBe(200);
  return (await response.json()) as AdminState;
}

describe("the square's ceiling", () => {
  test("turns new people away once full, and still lets whoever is in come back", async () => {
    await admin("reiniciar");
    const first = (await (await enter()).json()) as { sessao: string };
    expect((await enter()).status).toBe(200);
    expect((await enter()).status).toBe(200);

    const turnedAway = await enter();
    expect(turnedAway.status).toBe(409);
    expect(await turnedAway.json()).toEqual({
      ok: false,
      lotado: true,
      erro: "A praça lotou. Acompanhe pelo telão.",
    });

    const back = await enter(first.sessao);
    expect(back.status).toBe(200);
    expect(((await back.json()) as { created: boolean }).created).toBe(false);
  });

  test("the admin's simulated people stop at the same ceiling", async () => {
    await admin("reiniciar");
    expect((await enter()).status).toBe(200);
    const filled = await admin("simulados", { total: 60 });
    expect(filled.bonecos).toHaveLength(3);
    expect(filled.people.simulated).toBe(2);
  });
});

describe("the admin's restart", () => {
  test("lets back in whoever was expelled in the rehearsal", async () => {
    await admin("reiniciar");
    const entered = (await (await enter()).json()) as {
      boneco: string;
      sessao: string;
    };
    await admin("expulsar", { boneco: entered.boneco });
    expect((await enter(entered.sessao)).status).toBe(403);

    await admin("reiniciar");
    const again = await enter(entered.sessao);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { created: boolean }).created).toBe(true);
  });
});

describe("a world server that just started", () => {
  test("has no boneco without a person unless asked for one", async () => {
    const empty = startWorldServer({
      hubUrl: "http://127.0.0.1:9",
      roomName: "bloco-vazio",
      host: "127.0.0.1",
      port: 0,
      seed: 1,
    });
    try {
      const health = (await (await fetch(`${empty.url}/health`)).json()) as {
        bonecos: number;
      };
      expect(health.bonecos).toBe(0);
    } finally {
      await empty.stop();
    }
  });
});
