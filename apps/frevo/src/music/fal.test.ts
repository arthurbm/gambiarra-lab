import { afterEach, describe, expect, test } from "bun:test";
import { type FakeFal, type FakeFalBehavior, startFakeFal } from "./fake-fal";
import {
  createFalMusic,
  ELEVENLABS,
  type FalMusicOptions,
  MINIMAX,
  musicFromKey,
} from "./fal";
import { createMusicFiles } from "./files";
import { FREVO_STYLE } from "./generator";

const KEY = "fal-test-key-0123456789";
const INPUT = {
  blocoName: "Sombrinha Elétrica",
  refrain: [
    "Somos três no Recife Antigo",
    "Sombrinha girando no ar",
    "Quem tem frevo tem sempre um amigo",
    "Nosso bloco não vai parar",
  ],
  style: FREVO_STYLE,
};

let running: FakeFal | null = null;
afterEach(() => {
  running?.stop();
  running = null;
});

function setup(
  behaviors: { minimax: FakeFalBehavior; elevenlabs?: FakeFalBehavior },
  options: Partial<FalMusicOptions> = {}
) {
  const fake = startFakeFal({
    behaviors: {
      [MINIMAX]: behaviors.minimax,
      [ELEVENLABS]: behaviors.elevenlabs ?? { kind: "ok" },
    },
  });
  running = fake;
  const files = createMusicFiles();
  const lines: string[] = [];
  const music = createFalMusic({
    key: KEY,
    files,
    queueUrl: fake.url,
    pollMs: 5,
    timeoutsMs: { minimax: 200, elevenlabs: 200 },
    log: (line) => lines.push(line),
    ...options,
  });
  return { fake, files, lines, music };
}

describe("the fal.ai music", () => {
  test("MiniMax sings the refrain, and the world serves its own copy of the audio", async () => {
    const { fake, files, music, lines } = setup({ minimax: { kind: "ok" } });
    const { url } = await music.generate(INPUT);

    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.endpoint).toBe("fal-ai/minimax-music/v2.6");
    expect(request?.authorization).toBe(`Key ${KEY}`);
    expect(request?.input.prompt).toBe(
      `${FREVO_STYLE} Joyful mixed choir singing the chorus in Brazilian Portuguese. Short song, about 30 seconds.`
    );
    expect(request?.input.lyrics).toBe(
      "[Intro]\n[Chorus]\nSomos três no Recife Antigo\nSombrinha girando no ar\nQuem tem frevo tem sempre um amigo\nNosso bloco não vai parar\n[Outro]"
    );

    expect(url).toStartWith("/api/musica/");
    expect(url).not.toContain(fake.url);
    const copy = files.get(url);
    expect(copy?.type).toBe("audio/mpeg");
    expect(copy?.bytes.length).toBe(12);
    expect(music.generations()).toEqual({ used: 1, max: 6 });
    expect(lines.join("\n")).not.toContain(KEY);
  });
});

describe("when MiniMax does not deliver", () => {
  test("an error from MiniMax hands the refrain to ElevenLabs, sung in 30 s", async () => {
    const { fake, music } = setup({
      minimax: { kind: "error", status: 504 },
      elevenlabs: { kind: "ok" },
    });
    const { url } = await music.generate(INPUT);
    expect(url).toStartWith("/api/musica/");
    expect(fake.requests.map((request) => request.endpoint)).toEqual([
      "fal-ai/minimax-music/v2.6",
      "fal-ai/elevenlabs/music",
    ]);
    const eleven = fake.requests[1]?.input;
    expect(eleven?.music_length_ms).toBe(30_000);
    expect(eleven?.prompt).toEndWith(
      "exactly as written:\n\nSomos três no Recife Antigo\nSombrinha girando no ar\nQuem tem frevo tem sempre um amigo\nNosso bloco não vai parar"
    );
    expect(music.generations()).toEqual({ used: 2, max: 6 });
  });

  test("a MiniMax past its limit is cancelled and ElevenLabs takes over", async () => {
    const { fake, music } = setup(
      { minimax: { kind: "slow" }, elevenlabs: { kind: "ok" } },
      { timeoutsMs: { minimax: 60, elevenlabs: 200 } }
    );
    await music.generate(INPUT);
    await Bun.sleep(20);
    expect(fake.cancelled).toEqual(["req-1"]);
    expect(fake.requests[1]?.endpoint).toBe("fal-ai/elevenlabs/music");
  });

  test("when both fail the reasons come back, for the admin, and never the key", async () => {
    const { music, lines } = setup(
      { minimax: { kind: "slow" }, elevenlabs: { kind: "error", status: 500 } },
      { timeoutsMs: { minimax: 60, elevenlabs: 200 } }
    );
    const failure = await music.generate(INPUT).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "MiniMax passou de 0 s; ElevenLabs falhou (HTTP 500)"
    );
    expect(lines.join("\n")).not.toContain(KEY);
  });

  test("a refused request costs no generation", async () => {
    const { music } = setup({
      minimax: { kind: "refused", status: 422 },
      elevenlabs: { kind: "ok" },
    });
    await music.generate(INPUT);
    expect(music.generations()).toEqual({ used: 1, max: 6 });
  });
});

describe("the ceiling", () => {
  test("no more than six generations for the life of the server, even all at once", async () => {
    const { fake, music } = setup({
      minimax: { kind: "error" },
      elevenlabs: { kind: "error" },
    });
    const all = await Promise.allSettled(
      [1, 2, 3, 4].map((n) => music.generate({ ...INPUT, blocoName: `B${n}` }))
    );
    expect(fake.requests).toHaveLength(6);
    expect(music.generations()).toEqual({ used: 6, max: 6 });
    const reasons = all.map((outcome) =>
      outcome.status === "rejected" ? (outcome.reason as Error).message : ""
    );
    // Four MiniMax and two ElevenLabs: the last two blocos meet the ceiling.
    expect(
      reasons.filter((reason) => reason.includes("teto de 6"))
    ).toHaveLength(2);
  });

  test("the ceiling can be set", async () => {
    const { fake, music } = setup(
      { minimax: { kind: "ok" } },
      { maxGenerations: 1 }
    );
    await music.generate(INPUT);
    const second = await music.generate(INPUT).catch((error: Error) => error);
    expect((second as Error).message).toBe("teto de 1 gerações atingido");
    expect(fake.requests).toHaveLength(1);
  });
});

describe("without a key", () => {
  test("nothing is generated and the reason says why", async () => {
    const music = musicFromKey(undefined, { files: createMusicFiles() });
    expect(music.generations()).toBeNull();
    await expect(music.generate(INPUT)).rejects.toThrow("sem FAL_KEY");
  });
});

describe("a short refrain", () => {
  test("is sung twice by MiniMax, which follows the lyrics' length", async () => {
    const { fake, music } = setup({ minimax: { kind: "ok" } });
    await music.generate({
      ...INPUT,
      refrain: ["Lá vem a sombrinha", "Girando no ar"],
    });
    expect(fake.requests[0]?.input.lyrics).toBe(
      "[Intro]\n[Chorus]\nLá vem a sombrinha\nGirando no ar\n[Chorus]\nLá vem a sombrinha\nGirando no ar\n[Outro]"
    );
  });
});
