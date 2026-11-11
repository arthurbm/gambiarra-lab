import { describe, expect, test } from "bun:test";
import { acceptQuestion, RESERVE_QUESTIONS } from "./interview";
import {
  answerHuman,
  type BrainResult,
  createWorld,
  type DecisionRequest,
  type HumanAnswer,
  join,
  type PersonalityRequest,
  privateView,
  publicSnapshot,
  type QuestionRequest,
  step,
  type World,
} from "./world";

const TICK_MS = 100;
const ALONE_WITH_ONE_DOT = /sozinho: (Vou no passo|Fico aqui)\.$/;
const SESSION = "sessao-1";

type Brain = (request: DecisionRequest) => BrainResult | undefined;

/** A world with one person who just arrived, and its interview running. */
function arrived(rules = {}) {
  const start = step(createWorld({ seed: 3, bonecos: 0, rules }), {
    elapsedMs: TICK_MS,
    models: ["modelo-a"],
  }).world;
  return join(start, { sessionId: SESSION }).world;
}

/** Steps the world `ms`, answering every request with `brain` on the next tick. */
function run(world: World, ms: number, brain: Brain = () => undefined) {
  let current = world;
  let results: BrainResult[] = [];
  const requests: DecisionRequest[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    const next = step(current, { elapsedMs: TICK_MS, results });
    current = next.world;
    requests.push(...next.requests);
    results = next.requests.flatMap((request) => brain(request) ?? []);
  }
  return { world: current, requests };
}

/** The world after the person sends `answer`. */
function send(world: World, sent: HumanAnswer) {
  const { world: next } = answerHuman(world, {
    sessionId: SESSION,
    ...sent,
  });
  return next;
}

/** Steps without destructuring at every call. */
function after(world: World, ms: number, brain?: Brain) {
  const { world: next } = run(world, ms, brain);
  return next;
}

function phone(world: World) {
  const view = privateView(world, SESSION);
  if (!view) {
    throw new Error("the person has no view");
  }
  return view;
}

function answer(world: World, choice: number) {
  const { ask } = phone(world);
  if (!ask) {
    throw new Error("no question is open");
  }
  const answered = answerHuman(world, {
    sessionId: SESSION,
    askId: ask.id,
    choice,
  });
  expect(answered.error).toBeUndefined();
  return answered.world;
}

/** A brain that writes every question and personality. */
const writer: Brain = (request) => {
  if (request.kind === "question") {
    return {
      requestId: request.id,
      ok: true,
      model: "modelo-a",
      action: {
        type: "question",
        question: `Frevo ou maracatu, rodada ${request.index + 1}?`,
        options: ["Frevo", "Maracatu", "Os dois"],
      },
    };
  }
  if (request.kind === "personality") {
    return {
      requestId: request.id,
      ok: true,
      model: "modelo-a",
      action: {
        type: "personality",
        summary: "Dança frevo até de manhã.\nNão larga a sombrinha.",
        instrument: "trombone",
        speech: "Já sei quem tu é!",
      },
    };
  }
};

const failing: Brain = (request) => ({
  requestId: request.id,
  ok: false,
  reason: "the model answered without calling the tool",
});

describe("the interview with a person who answers", () => {
  test("three tap questions written by the model, an open one, then a personality and an instrument", () => {
    let world = after(arrived(), 300, writer);
    expect(phone(world).ask?.question).toBe("Frevo ou maracatu, rodada 1?");
    expect(phone(world).ask?.options).toEqual(["Frevo", "Maracatu", "Os dois"]);
    // Half a minute: people read the question on arrival, telão in sight.
    expect(phone(world).ask?.remainingMs).toBeGreaterThan(29_000);
    expect(phone(world).ask?.remainingMs).toBeLessThanOrEqual(30_000);
    expect(phone(world).ask?.totalMs).toBe(30_000);
    expect(phone(world).ask?.purpose).toBe("interview");
    // The question is the boneco's balloon on the telão.
    expect(publicSnapshot(world).bonecos[0]?.speech).toBe(
      "Frevo ou maracatu, rodada 1?"
    );

    const questions: QuestionRequest[] = [];
    let personality: PersonalityRequest | undefined;
    const recording: Brain = (request) => {
      if (request.kind === "question") {
        questions.push(request);
      }
      if (request.kind === "personality") {
        personality = request;
      }
      return writer(request);
    };
    world = answer(world, 0);
    world = after(world, 300, recording);
    world = answer(world, 1);
    world = after(world, 300, recording);
    world = answer(world, 2);

    expect(questions.map((request) => request.index)).toEqual([1, 2]);
    expect(questions[1]?.previous).toEqual([
      { question: "Frevo ou maracatu, rodada 1?", answer: "Frevo" },
      { question: "Frevo ou maracatu, rodada 2?", answer: "Maracatu" },
    ]);

    const open = phone(world).ask;
    expect(open?.options).toEqual([]);
    expect(open?.textMaxLength).toBe(80);

    world = send(world, {
      askId: open?.id as string,
      text: "Toco zabumba no quintal da minha avó em Olinda",
    });
    world = after(world, 300, recording);

    expect(personality?.answers.map((item) => item.answer)).toEqual([
      "Frevo",
      "Maracatu",
      "Os dois",
    ]);
    expect(personality?.freeText).toBe(
      "Toco zabumba no quintal da minha avó em Olinda"
    );

    const view = phone(world);
    expect(view.interview?.done).toBe(true);
    expect(view.ask).toBeNull();
    expect(view.boneco.personality).toEqual([
      "Dança frevo até de manhã.",
      "Não larga a sombrinha.",
    ]);
    expect(view.boneco.instrument).toBe("trombone");
    expect(publicSnapshot(world).bonecos[0]?.instrument).toBe("trombone");
    expect(view.thoughts.map((thought) => thought.text)).toContain(
      "Já sei quem tu é!"
    );
  });

  test("the free text never reaches the telão or the phone", () => {
    let world = after(arrived(), 300, writer);
    for (const choice of [0, 1, 2]) {
      world = answer(world, choice);
      world = after(world, 300, writer);
    }
    const secret = "meu segredo de carnaval";
    world = send(world, {
      askId: phone(world).ask?.id as string,
      text: secret,
    });
    world = after(world, 2000, writer);
    expect(JSON.stringify(publicSnapshot(world))).not.toContain(secret);
    expect(JSON.stringify(phone(world))).not.toContain(secret);
  });

  test("the open question can be skipped", () => {
    let world = after(arrived(), 300, writer);
    for (const choice of [0, 0, 0]) {
      world = answer(world, choice);
      world = after(world, 300, writer);
    }
    let personality: PersonalityRequest | undefined;
    world = send(world, {
      askId: phone(world).ask?.id as string,
      skip: true,
    });
    world = after(world, 300, (request) => {
      if (request.kind === "personality") {
        personality = request;
      }
      return writer(request);
    });
    expect(personality?.freeText).toBeNull();
    expect(phone(world).interview?.done).toBe(true);
  });

  test("an answer to a question that already passed is refused", () => {
    let world = after(arrived(), 300, writer);
    const first = phone(world).ask?.id as string;
    world = answer(world, 0);
    const late = answerHuman(world, {
      sessionId: SESSION,
      askId: first,
      choice: 1,
    });
    expect(late.error).toBeDefined();
    expect(late.world).toBe(world);
  });
});

describe("the interview with a person who does not answer", () => {
  test("after 30 seconds the boneco chooses alone and says so", () => {
    const world = after(arrived(), 300, writer);
    const options = phone(world).ask?.options as string[];

    const waiting = after(world, 29_500, writer);
    expect(phone(waiting).ask?.question).toBe("Frevo ou maracatu, rodada 1?");

    const alone = after(world, 30_300, writer);
    expect(phone(alone).ask?.question).toBe("Frevo ou maracatu, rodada 2?");
    const notice = phone(alone).thoughts.find(
      (thought) => thought.tone === "aviso"
    );
    expect(notice?.text).toContain("escolhi sozinho");
    expect(options.some((option) => notice?.text.includes(option))).toBe(true);
  });

  test("the notice reads well when the option ends with punctuation", () => {
    const dotted: Brain = (request) =>
      request.kind === "question"
        ? {
            requestId: request.id,
            ok: true,
            action: {
              type: "question",
              question: "Bora?",
              options: ["Vou no passo.", "Fico aqui!"],
            },
          }
        : undefined;
    const alone = after(arrived(), 30_500, dotted);
    const notice = phone(alone).thoughts.find(
      (thought) => thought.tone === "aviso"
    );
    expect(notice?.text).toMatch(ALONE_WITH_ONE_DOT);
  });

  test("the whole interview finishes alone, open question included", () => {
    let personality: PersonalityRequest | undefined;
    const world = after(arrived(), 150_000, (request) => {
      if (request.kind === "personality") {
        personality = request;
      }
      return writer(request);
    });
    expect(personality?.answers).toHaveLength(3);
    expect(personality?.freeText).toBeNull();
    expect(phone(world).interview?.done).toBe(true);
    expect(phone(world).boneco.instrument).toBe("trombone");
  });

  test("typing in the open question holds the countdown, up to a cap", () => {
    let world = after(arrived(), 300, writer);
    for (const choice of [0, 0, 0]) {
      world = answer(world, choice);
      world = after(world, 300, writer);
    }
    const open = phone(world).ask?.id as string;
    world = after(world, 25_000);
    world = send(world, {
      askId: open,
      typing: true,
    });
    world = after(world, 10_000);
    expect(phone(world).ask?.id).toBe(open);
    expect(phone(world).ask?.remainingMs).toBeGreaterThan(0);

    for (let typed = 0; typed < 10; typed += 1) {
      world = send(world, {
        askId: open,
        typing: true,
      });
      world = after(world, 10_000);
    }
    expect(phone(world).ask?.id).not.toBe(open);
  });
});

describe("the interview when the brain fails", () => {
  test("uses fixed questions, finishes with a personality from the answers, and the boneco walks on", () => {
    let world = after(arrived(), 300, failing);
    const reserves = RESERVE_QUESTIONS.map((reserve) => reserve.question);
    const seen: string[] = [];
    for (const choice of [0, 1, 2]) {
      const { ask } = phone(world);
      expect(reserves).toContain(ask?.question as string);
      seen.push(ask?.question as string);
      world = answer(world, choice);
      world = after(world, 300, failing);
    }
    expect(new Set(seen).size).toBe(3);
    expect(
      phone(world).thoughts.some((thought) => thought.tone === "aviso")
    ).toBe(true);

    world = send(world, {
      askId: phone(world).ask?.id as string,
      skip: true,
    });
    world = after(world, 300, failing);

    const view = phone(world);
    expect(view.interview?.done).toBe(true);
    expect(view.boneco.personality).toHaveLength(2);
    expect(view.boneco.instrument).not.toBeNull();
    // Fixed questions are not model text: they never go to the balloon.
    expect(publicSnapshot(world).bonecos[0]?.speech).toBeNull();

    const walking = after(world, 3000, failing);
    expect(publicSnapshot(walking).bonecos[0]?.walking).toBe(true);
  });

  test("a brain that never answers gets a fixed question after its deadline", () => {
    const world = arrived({ interviewThinkMs: 2000 });
    const thinking = after(world, 1500);
    expect(phone(thinking).ask).toBeNull();
    expect(phone(thinking).boneco.thinking).toBe(true);
    const reserve = after(world, 2200);
    expect(RESERVE_QUESTIONS.map((item) => item.question)).toContain(
      phone(reserve).ask?.question as string
    );
  });

  test("a question with one option, or repeated options, is not used", () => {
    const bad: Brain = (request) =>
      request.kind === "question"
        ? {
            requestId: request.id,
            ok: true,
            action: {
              type: "question",
              question: "Frevo?",
              options: ["Sim", "sim"],
            },
          }
        : undefined;
    const world = after(arrived(), 300, bad);
    expect(RESERVE_QUESTIONS.map((item) => item.question)).toContain(
      phone(world).ask?.question as string
    );
  });
});

describe("model text and the blocklist", () => {
  test("a question with a blocked word is replaced by a fixed one", () => {
    const rude: Brain = (request) =>
      request.kind === "question"
        ? {
            requestId: request.id,
            ok: true,
            action: {
              type: "question",
              question: "Que porra de frevo tu curte?",
              options: ["Esse", "Aquele"],
            },
          }
        : undefined;
    const world = after(arrived(), 300, rude);
    expect(phone(world).ask?.question).not.toContain("porra");
    expect(JSON.stringify(publicSnapshot(world))).not.toContain("porra");
  });

  test("a walking line with a blocked word or foreign letters never reaches the balloon", () => {
    for (const speech of ["Vou pra MERDA da fonte", "Ô meu人力资源, bora"]) {
      const start = createWorld({ seed: 1, bonecos: 1 });
      const asked = step(start, { elapsedMs: TICK_MS });
      const [request] = asked.requests as [DecisionRequest];
      const decided = step(asked.world, {
        elapsedMs: TICK_MS,
        results: [
          {
            requestId: request.id,
            ok: true,
            action: { type: "walk", placeId: "fonte", speech },
          },
        ],
      });
      const [boneco] = publicSnapshot(decided.world).bonecos;
      expect(boneco?.walking).toBe(true);
      expect(boneco?.speech).toBeNull();
    }
  });
});

describe("a question the model numbered", () => {
  test("loses the number before it reaches the phone", () => {
    for (const question of [
      "Pergunta 2 de 3: qual é o seu prato preferido?",
      "pergunta 3/3 - qual é o seu prato preferido?",
      "Pergunta 1: qual é o seu prato preferido?",
      "2 de 3: qual é o seu prato preferido?",
      "2/3) qual é o seu prato preferido?",
    ]) {
      expect(acceptQuestion(question, ["Tapioca", "Cuscuz"])?.question).toBe(
        "Qual é o seu prato preferido?"
      );
    }
  });

  test("keeps a question that only has a number inside", () => {
    expect(
      acceptQuestion("Tu dança 3 horas de frevo?", ["Sim", "Não"])?.question
    ).toBe("Tu dança 3 horas de frevo?");
  });
});
