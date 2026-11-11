import { describe, expect, test } from "bun:test";
import {
  EMBEDDED_TRACK,
  embeddedMusic,
  type MusicGenerator,
} from "./generator";
import { createJukebox } from "./jukebox";

const BLOCO = {
  blocoId: "bloco-1",
  blocoName: "Sombrinha Elétrica",
  refrain: ["Lá vem a sombrinha", "Girando no ar"],
};

/** A generator the test answers by hand. */
function manual() {
  const calls: Parameters<MusicGenerator>[0][] = [];
  let settle: {
    reject: (error: Error) => void;
    resolve: (url: string) => void;
  } | null = null;
  const generator: MusicGenerator = (input) => {
    calls.push(input);
    return new Promise((resolve, reject) => {
      settle = { resolve: (url) => resolve({ url }), reject };
    });
  };
  return {
    calls,
    generator,
    resolve: (url: string) => settle?.resolve(url),
    reject: (error: Error) => settle?.reject(error),
  };
}

describe("the music", () => {
  test("the default generator answers with the embedded track", async () => {
    expect(await embeddedMusic({ ...BLOCO, style: "frevo" })).toEqual({
      url: EMBEDDED_TRACK,
    });
  });
});

describe("the jukebox", () => {
  test("preparing a bloco asks the generator once, with the frevo style", async () => {
    const fake = manual();
    const jukebox = createJukebox({ generator: fake.generator });
    jukebox.prepare(BLOCO);
    jukebox.prepare(BLOCO);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      blocoName: "Sombrinha Elétrica",
      refrain: BLOCO.refrain,
    });
    expect(fake.calls[0]?.style).toContain("150 BPM");
    expect(jukebox.tracks()).toEqual({
      "bloco-1": { state: "gerando", url: null, reason: null },
    });
    fake.resolve("https://musica/1.mp3");
    await Bun.sleep(0);
    expect(jukebox.tracks()["bloco-1"]).toEqual({
      state: "pronta",
      url: "https://musica/1.mp3",
      reason: null,
    });
  });

  test("playing a bloco whose music is ready sends its url to the telão, with the embedded track as a fallback", async () => {
    const jukebox = createJukebox({
      generator: async () => ({ url: "https://musica/1.mp3" }),
    });
    jukebox.prepare(BLOCO);
    await Bun.sleep(0);
    const first = jukebox.play(BLOCO);
    expect(first).toMatchObject({
      blocoId: "bloco-1",
      url: "https://musica/1.mp3",
      fallbackUrl: EMBEDDED_TRACK,
    });
    const again = jukebox.play(BLOCO);
    expect(again.id).toBeGreaterThan(first.id);
    expect(jukebox.current()).toEqual(again);
  });

  test("playing before the music is ready plays the embedded track and the dynamic goes on", () => {
    const fake = manual();
    const jukebox = createJukebox({ generator: fake.generator });
    expect(jukebox.play(BLOCO).url).toBe(EMBEDDED_TRACK);
    expect(fake.calls).toHaveLength(1);
  });

  test("a generator that fails or takes too long leaves the embedded track", async () => {
    const failing = manual();
    const jukebox = createJukebox({ generator: failing.generator });
    jukebox.prepare(BLOCO);
    failing.reject(new Error("fal 504"));
    await Bun.sleep(0);
    expect(jukebox.tracks()["bloco-1"]).toEqual({
      state: "reserva",
      url: EMBEDDED_TRACK,
      reason: "fal 504",
    });

    const slow = manual();
    const patient = createJukebox({ generator: slow.generator, timeoutMs: 20 });
    patient.prepare(BLOCO);
    await Bun.sleep(40);
    expect(patient.tracks()).toMatchObject({
      "bloco-1": { state: "reserva", reason: "passou de 0 s" },
    });
    slow.resolve("https://musica/tarde.mp3");
    await Bun.sleep(0);
    expect(patient.tracks()).toMatchObject({
      "bloco-1": { state: "reserva" },
    });
  });

  test("stopping sends the telão a command with no track", () => {
    const jukebox = createJukebox({ generator: embeddedMusic });
    jukebox.play(BLOCO);
    expect(jukebox.stop()).toMatchObject({ blocoId: null, url: null });
  });

  test("the sound is on while a telão that turned it on keeps reporting", () => {
    let now = 0;
    const jukebox = createJukebox({
      generator: embeddedMusic,
      now: () => now,
    });
    expect(jukebox.sound()).toEqual({ enabled: false, playing: null });
    jukebox.report("telao-a", { enabled: true, playing: "bloco-1" });
    expect(jukebox.sound()).toEqual({ enabled: true, playing: "bloco-1" });
    now = 30_000;
    expect(jukebox.sound()).toEqual({ enabled: false, playing: null });
  });

  test("keeps a handful of telões, forgetting the one that reported longest ago", () => {
    let now = 0;
    const jukebox = createJukebox({ generator: embeddedMusic, now: () => now });
    jukebox.report("telao-velho", { enabled: true, playing: "bloco-1" });
    for (let index = 0; index < 50; index += 1) {
      now += 1;
      jukebox.report(`telao-${index}`, { enabled: false, playing: null });
    }
    expect(jukebox.sound()).toEqual({ enabled: false, playing: null });
    // A telão that keeps reporting is the newest, and stays.
    jukebox.report("telao-49", { enabled: true, playing: "bloco-2" });
    for (let index = 0; index < 3; index += 1) {
      now += 1;
      jukebox.report(`outro-${index}`, { enabled: false, playing: null });
    }
    expect(jukebox.sound()).toEqual({ enabled: true, playing: "bloco-2" });
  });

  test("resetting forgets the tracks, the command and late answers", async () => {
    const fake = manual();
    const jukebox = createJukebox({ generator: fake.generator });
    jukebox.play(BLOCO);
    jukebox.reset();
    fake.resolve("https://musica/velha.mp3");
    await Bun.sleep(0);
    expect(jukebox.tracks()).toEqual({});
    expect(jukebox.current()).toBeNull();
  });
});
