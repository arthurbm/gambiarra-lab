import { describe, expect, test } from "bun:test";
import { expel, setSilenced } from "./admin";
import { NAME_MAX_LENGTH, VERSE_MAX_LENGTH } from "./compor";
import { advancePhase, setPhaseDurations, tick } from "./phases";
import {
  answerHuman,
  type BrainResult,
  createWorld,
  type DecisionRequest,
  type HumanAnswer,
  join,
  type PrivateView,
  type PublicSnapshot,
  privateView,
  publicSnapshot,
  type World,
  type WorldMap,
} from "./world";

const TICK_MS = 100;

const ONE_SPOT: WorldMap = {
  width: 20,
  height: 20,
  places: [{ id: "roda", name: "Roda", x: 10, y: 10 }],
};

type Brain = (request: DecisionRequest) => BrainResult | undefined;
/** What a person does with the question on their phone. */
type Human = (view: PrivateView) => HumanAnswer | undefined;

function ok(request: DecisionRequest, action: unknown): BrainResult {
  return {
    ok: true,
    requestId: request.id,
    model: "modelo-a",
    action: action as Extract<BrainResult, { ok: true }>["action"],
  };
}

/** Finishes the interview at once; never meets anyone. */
function interview(request: DecisionRequest): BrainResult | undefined {
  if (request.kind === "question") {
    return ok(request, {
      type: "question",
      question: `Pergunta ${request.index + 1}?`,
      options: ["Sim", "Não"],
    });
  }
  if (request.kind === "personality") {
    return ok(request, {
      type: "personality",
      summary: `${request.boneco.name} ama tapioca.\nDança na chuva.`,
      instrument: "tuba",
      speech: "Cheguei!",
    });
  }
}

/** Proposes "Bloco de <name>" and a two-verse refrain naming the boneco. */
const composer: Brain = (request) => {
  if (request.kind === "nome") {
    return ok(request, {
      type: "nome",
      name: `Bloco de ${request.boneco.name}`,
    });
  }
  if (request.kind === "refrao") {
    return ok(request, {
      type: "refrao",
      common: "Todo mundo ama tapioca",
      lines: [
        `${request.current ? "Ajuste" : "Refrão"} de ${request.boneco.name}`,
        "Tapioca no passo do frevo",
      ],
    });
  }
  return interview(request);
};

const answersInterview: Human = (view) => {
  if (!view.ask || view.compor?.voting) {
    return;
  }
  return view.ask.options.length > 0
    ? { askId: view.ask.id, choice: 0 }
    : { askId: view.ask.id, skip: true };
};

/** Votes for the option a boneco named `name` proposed. */
function votesFor(name: string): Human {
  return (view) => {
    if (!(view.ask && view.compor?.voting)) {
      return answersInterview(view);
    }
    const index = view.compor.options.findIndex((option) => option.by === name);
    return { askId: view.ask.id, choice: Math.max(0, index) };
  };
}

/** Never votes. */
const silent: Human = (view) =>
  view.compor?.voting ? undefined : answersInterview(view);

interface RunOptions {
  brain?: Brain;
  human?: (session: string) => Human;
}

function sessions(world: World): string[] {
  return world.bonecos.flatMap((boneco) =>
    boneco.sessionId ? [boneco.sessionId] : []
  );
}

/** Runs the phase clock `ms`, brains answering on the next tick. */
function run(world: World, ms: number, options: RunOptions = {}) {
  const brain = options.brain ?? composer;
  let current = world;
  let results: BrainResult[] = [];
  const requests: DecisionRequest[] = [];
  const views: PrivateView[] = [];
  const snapshots: PublicSnapshot[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    const next = tick(current, { elapsedMs: TICK_MS, results });
    current = next.world;
    snapshots.push(publicSnapshot(current));
    requests.push(...next.requests);
    results = next.requests.flatMap((request) => brain(request) ?? []);
    for (const session of sessions(current)) {
      const view = privateView(current, session);
      if (view) {
        views.push(view);
      }
      const answer =
        view && (options.human?.(session) ?? answersInterview)(view);
      if (answer) {
        current = answerHuman(current, { sessionId: session, ...answer }).world;
      }
    }
  }
  return { world: current, requests, views, snapshots };
}

/** Runs until the bloco's first vote opens, nobody voting. */
function untilVoting(world: World): World {
  const brain = composer;
  let current = world;
  let results: BrainResult[] = [];
  for (let elapsed = 0; elapsed < 30_000; elapsed += TICK_MS) {
    const next = tick(current, { elapsedMs: TICK_MS, results });
    current = next.world;
    results = next.requests.flatMap((request) => brain(request) ?? []);
    if (privateView(current, "pessoa-1")?.compor?.voting) {
      return current;
    }
  }
  throw new Error("the vote never opened");
}

/**
 * A square in the compor phase with one bloco of `humans` people (and
 * `simulated` bonecos without a phone), all done with the interview.
 */
function composing(options: {
  composeMs?: number;
  humans: number;
  simulated?: number;
}): World {
  let world = createWorld({
    seed: 11,
    bonecos: options.simulated ?? 0,
    map: ONE_SPOT,
    rules: { meetRadius: 0 },
  });
  ({ world } = tick(world, { elapsedMs: TICK_MS, models: ["modelo-a"] }));
  for (let index = 0; index < options.humans; index += 1) {
    ({ world } = join(world, { sessionId: `pessoa-${index + 1}` }));
  }
  ({ world } = run(world, 3000, { brain: interview }));
  world = setPhaseDurations(world, { compor: options.composeMs ?? 150_000 });
  world = advancePhase(world); // formar
  world = advancePhase(world); // compor: the leftovers form one bloco
  expect(world.phase).toBe("compor");
  expect(world.blocos).toHaveLength(1);
  return world;
}

function names(world: World): string[] {
  return world.bonecos.map((boneco) => boneco.name);
}

function bloco(world: World) {
  return publicSnapshot(world).blocos[0];
}

describe("the name round", () => {
  test("each boneco proposes a name, the three phones see the same options and the majority wins", () => {
    const world = composing({ humans: 3 });
    const [first, second, third] = names(world) as [string, string, string];
    const {
      world: after,
      requests,
      views,
    } = run(world, 8000, {
      human: (session) => votesFor(session === "pessoa-1" ? first : third),
    });
    // One proposal per boneco, by model decision.
    const proposals = requests.filter((request) => request.kind === "nome");
    expect(proposals).toHaveLength(3);
    // While voting, every phone shows the same options.
    const voting = views.filter(
      (view) => view.compor?.voting && view.compor.round === "nome"
    );
    const shown = new Set(
      voting.map((view) => JSON.stringify(view.compor?.options))
    );
    expect(shown.size).toBe(1);
    expect(voting[0]?.compor?.options.map((option) => option.by)).toEqual([
      first,
      second,
      third,
    ]);
    // pessoa-1 votes for the first, the other two for the third.
    expect(bloco(after)?.name).toBe(`Bloco de ${third}`);
    const log = publicSnapshot(after).events.map((event) => event.text);
    expect(log.some((text) => text.includes(`«Bloco de ${third}»`))).toBe(true);
  });

  test("a silenced boneco's proposal stays off the telão, and the name the bloco chose stays the bloco's", () => {
    let world = composing({ humans: 3 });
    const [first] = names(world) as [string];
    const silencedId = world.bonecos[0]?.id as string;
    world = setSilenced(world, silencedId, true);
    const { world: after, snapshots } = run(world, 8000, {
      human: () => votesFor(first),
    });
    expect(bloco(after)?.name).toBe(`Bloco de ${first}`);
    const shown = snapshots.flatMap((snapshot) => [
      ...snapshot.bonecos.flatMap((boneco) => boneco.speech ?? []),
      ...snapshot.events.map((event) => event.text),
    ]);
    expect(shown.some((text) => text.includes(`Bloco de ${first}`))).toBe(
      false
    );
    // Allowed to speak again, its lines are back in the log.
    const allowed = setSilenced(after, silencedId, false);
    expect(
      publicSnapshot(allowed).events.some((event) =>
        event.text.includes(`Bloco de ${first}`)
      )
    ).toBe(true);
  });

  test("the phones show how many voted, also to who already voted", () => {
    const world = composing({ humans: 3 });
    const [first] = names(world) as [string];
    // Only pessoa-1 votes; the others let the time run out.
    const { views } = run(world, 6000, {
      human: (session) => (session === "pessoa-1" ? votesFor(first) : silent),
    });
    const counted = views.filter(
      (view) => view.compor?.voting && view.compor.votes === 1
    );
    expect(counted.length).toBeGreaterThan(0);
    // The one who voted no longer has the question, and still sees the count.
    const voter = counted.find(
      (view) => view.ask === null && view.compor?.yourVote === 0
    );
    expect(voter?.compor?.voters).toBe(3);
    expect(voter?.compor?.options).toHaveLength(3);
  });

  test("a tie is drawn among the tied options", () => {
    // Two humans, one vote each for a different name: either may win, and
    // seeds tell the draw apart.
    const winners = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let world = composing({ humans: 2 });
      world = { ...world, rng: seed * 7919 };
      const [first, second] = names(world) as [string, string];
      const after = run(world, 8000, {
        human: (session) => votesFor(session === "pessoa-1" ? first : second),
      }).world;
      const name = bloco(after)?.name ?? "";
      expect([`Bloco de ${first}`, `Bloco de ${second}`]).toContain(name);
      winners.add(name.replace(first, "A").replace(second, "B"));
    }
    expect(winners.size).toBe(2);
  });

  test("with no vote, the first proposal wins", () => {
    const world = composing({ humans: 3 });
    const [first] = names(world) as [string];
    const { world: after, views } = run(world, 15_000, {
      human: () => silent,
    });
    expect(bloco(after)?.name).toBe(`Bloco de ${first}`);
    // Each phone was told its vote did not count.
    const told = views.some((view) =>
      view.thoughts.some((thought) => thought.text.includes("não votou"))
    );
    expect(told).toBe(true);
  });

  test("a boneco whose model does not propose is left out, and the bloco goes on", () => {
    const world = composing({ humans: 3 });
    const [first, second, third] = names(world) as [string, string, string];
    const failing: Brain = (request) =>
      request.boneco.name === second && request.kind === "nome"
        ? { ok: false, requestId: request.id, reason: "erro do provedor" }
        : composer(request);
    const { world: after, views } = run(world, 8000, {
      brain: failing,
      human: () => votesFor(third),
    });
    const options = views.find((view) => view.compor?.voting)?.compor?.options;
    expect(options?.map((option) => option.by)).toEqual([first, third]);
    expect(bloco(after)?.name).toBe(`Bloco de ${third}`);
  });

  test("a name too long or with a blocked word is not offered", () => {
    const world = composing({ humans: 3 });
    const [first, second, third] = names(world) as [string, string, string];
    const brain: Brain = (request) => {
      if (request.kind !== "nome") {
        return composer(request);
      }
      if (request.boneco.name === first) {
        return ok(request, {
          type: "nome",
          name: "x".repeat(NAME_MAX_LENGTH + 1),
        });
      }
      if (request.boneco.name === second) {
        return ok(request, { type: "nome", name: "Bloco da Porra" });
      }
      return composer(request);
    };
    const after = run(world, 8000, { brain, human: () => silent }).world;
    // Only one proposal was left: it wins without a vote.
    expect(bloco(after)?.name).toBe(`Bloco de ${third}`);
  });
});

describe("the refrain round", () => {
  test("after the name, each boneco proposes two to four verses about what the humans share, and the humans vote", () => {
    const world = composing({ humans: 3 });
    const [, second] = names(world) as [string, string];
    const { world: after, requests } = run(world, 25_000, {
      human: () => votesFor(second),
    });
    const refrains = requests.filter((request) => request.kind === "refrao");
    expect(refrains.length).toBeGreaterThanOrEqual(3);
    const [first] = refrains;
    // The first carries every human's personality, to find what they share.
    expect(first?.kind === "refrao" && first.people).toHaveLength(3);
    expect(
      first?.kind === "refrao" &&
        first.people.every((person) => person.personality !== null)
    ).toBe(true);
    expect(first?.kind === "refrao" && first.blocoName).toBe(
      `Bloco de ${second}`
    );
    expect(bloco(after)?.refrain?.[0]).toMatch(`de ${second}`);
    expect(bloco(after)?.refrain).toHaveLength(2);
  });

  test("a refrain with a verse over the limit, or with one or five verses, is not offered", () => {
    const world = composing({ humans: 3 });
    const [first, second, third] = names(world) as [string, string, string];
    const brain: Brain = (request) => {
      if (request.kind !== "refrao") {
        return composer(request);
      }
      const lines: Record<string, string[]> = {
        [first]: ["Curto", "y".repeat(VERSE_MAX_LENGTH + 1)],
        [second]: ["Um verso só"],
        [third]: ["Verso um", "Verso dois", "Verso três"],
      };
      return ok(request, {
        type: "refrao",
        common: "frevo",
        lines: lines[request.boneco.name],
      });
    };
    const after = run(world, 25_000, { brain, human: () => silent }).world;
    expect(bloco(after)?.refrain).toEqual([
      "Verso um",
      "Verso dois",
      "Verso três",
    ]);
  });

  test("with time left, a rework round lets the humans keep the refrain or take an adjusted one", () => {
    const world = composing({ humans: 3 });
    const [first] = names(world) as [string];
    const human: Human = (view) => {
      if (view.ask && view.compor?.voting && view.compor.round === "ajuste") {
        // The first option keeps the refrain; the second is an adjustment.
        expect(view.compor.options[0]?.by).toBeNull();
        return { askId: view.ask.id, choice: 1 };
      }
      return votesFor(first)(view);
    };
    const { world: after, requests } = run(world, 45_000, {
      human: () => human,
    });
    const rework = requests.filter(
      (request) => request.kind === "refrao" && request.current !== null
    );
    expect(rework).toHaveLength(3);
    expect(bloco(after)?.refrain?.[0]).toMatch("Ajuste de");
  });

  test("without time left, there is no rework round", () => {
    const world = composing({ humans: 3, composeMs: 40_000 });
    const { requests } = run(world, 39_000, { human: () => silent });
    expect(
      requests.some(
        (request) => request.kind === "refrao" && request.current !== null
      )
    ).toBe(false);
  });
});

describe("blocos of two and four", () => {
  test("vote with the same rules", () => {
    for (const humans of [2, 4]) {
      const world = composing({ humans });
      const all = names(world);
      const last = all.at(-1) as string;
      const { world: after, views } = run(world, 25_000, {
        // Everyone votes for the last boneco's proposals.
        human: () => votesFor(last),
      });
      const options = views.find((view) => view.compor?.voting)?.compor;
      expect(options?.options).toHaveLength(humans);
      expect(options?.voters).toBe(humans);
      expect(bloco(after)?.name).toBe(`Bloco de ${last}`);
      // The refrain, and its rework, came from the last boneco.
      expect(bloco(after)?.refrain?.[0]).toMatch(`de ${last}`);
    }
  });
});

describe("the end of the phase", () => {
  test("every bloco has a name and a refrain, even with every model down and nobody voting", () => {
    let world = composing({ humans: 3, simulated: 1, composeMs: 20_000 });
    // A simulated boneco without a phone is in the bloco too.
    expect(world.blocos[0]?.members).toHaveLength(4);
    const down: Brain = (request) => ({
      ok: false,
      requestId: request.id,
      reason: "fora do ar",
    });
    ({ world } = run(world, 20_000, { brain: down, human: () => silent }));
    expect(world.phase).toBe("desfile");
    const [only] = publicSnapshot(world).blocos;
    expect(only?.name).toBeTruthy();
    expect(only?.refrain?.length).toBeGreaterThanOrEqual(2);
    expect(only?.refrain?.length).toBeLessThanOrEqual(4);
    // Nobody is left waiting for a model or a vote.
    expect(world.bonecos.every((boneco) => boneco.pending === null)).toBe(true);
    expect(world.bonecos.every((boneco) => boneco.ask === null)).toBe(true);
  });

  test("a bloco with no human and models that never answer still gets both", () => {
    let world = composing({ humans: 0, simulated: 3, composeMs: 5000 });
    ({ world } = run(world, 5000, { brain: () => undefined }));
    expect(world.phase).toBe("desfile");
    const [only] = publicSnapshot(world).blocos;
    expect(only?.name).toBeTruthy();
    expect(only?.refrain?.length).toBeGreaterThanOrEqual(2);
  });

  test("a vote still open when the phase ends counts the votes given so far", () => {
    let world = composing({ humans: 3, composeMs: 3000 });
    const [, , third] = names(world) as [string, string, string];
    ({ world } = run(world, 3000, {
      human: (session) => (session === "pessoa-1" ? votesFor(third) : silent),
    }));
    expect(world.phase).toBe("desfile");
    expect(publicSnapshot(world).blocos[0]?.name).toBe(`Bloco de ${third}`);
  });
});

describe("arrivals during the phase", () => {
  test("each bloco walks to its meeting spot", () => {
    const world = composing({ humans: 3 });
    const after = run(world, 3000).world;
    const spot = after.blocos[0]?.spot;
    for (const boneco of after.bonecos) {
      expect(Math.abs(boneco.y - (spot?.y ?? -1))).toBeLessThan(1);
    }
  });

  test("a late arrival joins the vote still open", () => {
    let world = composing({ humans: 3 });
    // Run until the name vote opens, then a fourth person arrives.
    world = untilVoting(world);
    ({ world } = join(world, { sessionId: "pessoa-4" }));
    const { world: after, views } = run(world, 12_000, {
      human: () => silent,
    });
    expect(after.blocos[0]?.members).toHaveLength(4);
    // Once done with the interview, the late one sees and gets the open vote,
    // or the next round's.
    const lateVoting = views.find(
      (view) =>
        view.boneco.id === after.bonecos.at(-1)?.id && view.compor?.voting
    );
    expect(lateVoting?.compor?.voters).toBe(4);
  });

  test("an expelled member no longer holds the vote", () => {
    let world = composing({ humans: 3 });
    world = untilVoting(world);
    const third = world.bonecos[2]?.id as string;
    ({ world } = expel(world, third));
    const [first] = names(world) as [string];
    const after = run(world, 4000, { human: () => votesFor(first) }).world;
    expect(bloco(after)?.name).toBe(`Bloco de ${first}`);
  });
});
