// A person picks their boneco on the phone: `look` in `POST /api/entrar` and
// the looks already on the square in `GET /api/visuais`. No hub: nothing here
// needs a model.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { PrivateView } from "../sim/world";
import { openEventStream } from "../testing/sse";
import { startWorldServer, type WorldServer } from "./app";

const SECRET = "segredo-dos-visuais";

let server: WorldServer;

beforeAll(() => {
  server = startWorldServer({
    tickMs: 20,
    publishMs: 40,
    hubUrl: "http://127.0.0.1:9",
    roomName: "bloco-dos-visuais",
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

beforeEach(async () => {
  const restarted = await post("/api/admin/reiniciar", {}, SECRET);
  expect(restarted.status).toBe(200);
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

async function inUse(): Promise<{ emUso: number[]; total: number }> {
  const response = await fetch(`${server.url}/api/visuais`);
  expect(response.status).toBe(200);
  return (await response.json()) as { emUso: number[]; total: number };
}

async function lookOf(sessao: string): Promise<number> {
  const stream = await openEventStream<PrivateView>(
    `${server.url}/events/celular?sessao=${encodeURIComponent(sessao)}`
  );
  try {
    return (await stream.find(() => true)).boneco.look;
  } finally {
    stream.close();
  }
}

describe("picking a boneco", () => {
  test("the looks in use start empty and list every boneco's look", async () => {
    expect(await inUse()).toEqual({ total: 30, emUso: [] });
    await post("/api/entrar", { look: 12 });
    await post("/api/entrar", { look: 3 });
    const drawn = (await (await post("/api/entrar", {})).json()) as {
      sessao: string;
    };
    const third = await lookOf(drawn.sessao);
    expect((await inUse()).emUso).toEqual([3, 12, third].sort((a, b) => a - b));
  });

  test("a valid look gives that boneco", async () => {
    const response = await post("/api/entrar", { nome: "Ana", look: 7 });
    expect(response.status).toBe(200);
    const { sessao } = (await response.json()) as { sessao: string };
    expect(await lookOf(sessao)).toBe(7);
  });

  test("an invalid look is refused with 400", async () => {
    for (const look of [-1, 30, 2.5, "3", true, [1]]) {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time keeps the square empty.
      const response = await post("/api/entrar", { look });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false });
    }
    expect((await inUse()).emUso).toEqual([]);
  });

  test("a look in use is refused with 409 and nobody joins", async () => {
    expect((await post("/api/entrar", { look: 5 })).status).toBe(200);
    const taken = await post("/api/entrar", { nome: "Bia", look: 5 });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      ok: false,
      visualOcupado: true,
      erro: "Esse boneco já está na praça. Escolha outro.",
    });
    expect((await inUse()).emUso).toEqual([5]);
  });

  test("without a look, or with null, a free one is drawn", async () => {
    for (let index = 0; index < 28; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each arrival sees the one before.
      const response = await post("/api/entrar", { look: index });
      expect(response.status).toBe(200);
    }
    // Only 28 and 29 are free: the two draws take them, one each.
    const drawn: number[] = [];
    for (const body of [{ look: null }, {}]) {
      // biome-ignore lint/performance/noAwaitInLoops: the second draw sees the first.
      const response = await post("/api/entrar", body);
      expect(response.status).toBe(200);
      const { sessao } = (await response.json()) as { sessao: string };
      drawn.push(await lookOf(sessao));
    }
    expect(drawn.sort((a, b) => a - b)).toEqual([28, 29]);
  });

  test("a known session keeps its boneco and ignores the look", async () => {
    const first = (await (await post("/api/entrar", { look: 9 })).json()) as {
      sessao: string;
    };
    const again = await post("/api/entrar", { sessao: first.sessao, look: 99 });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false });
    expect(await lookOf(first.sessao)).toBe(9);
  });
});
