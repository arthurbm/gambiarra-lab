import { describe, expect, test } from "bun:test";
import { expel } from "./admin";
import { closeFormar, enterFormar, sizesFor } from "./formar";
import { MEETING_SPOTS } from "./meeting-spots";
import {
  answerHuman,
  type BrainResult,
  createWorld,
  type DecisionRequest,
  type EncounterRequest,
  type HumanAnswer,
  join,
  type MaestroRequest,
  PRACA,
  type PrivateView,
  privateView,
  publicSnapshot,
  step,
  type World,
  type WorldMap,
} from "./world";

const TICK_MS = 100;

/** A square so small that every boneco is born on the same spot. */
const ONE_SPOT: WorldMap = {
  width: 20,
  height: 20,
  places: [{ id: "roda", name: "Roda", x: 10, y: 10 }],
};

type Brain = (request: DecisionRequest) => BrainResult | undefined;
/** What a person does with the question on their phone; nothing waits. */
type Human = (view: PrivateView) => HumanAnswer | undefined;

function ok(request: DecisionRequest, action: unknown): BrainResult {
  return {
    ok: true,
    requestId: request.id,
    model: "modelo-a",
    action: action as Extract<BrainResult, { ok: true }>["action"],
  };
}

/** Answers the interview at once and likes everyone it meets. */
const friendly: Brain = (request) => {
  switch (request.kind) {
    case "question":
      return ok(request, {
        type: "question",
        question: `Pergunta ${request.index + 1}?`,
        options: ["Sim", "Não"],
      });
    case "personality":
      return ok(request, {
        type: "personality",
        summary: `Gosta de ${request.boneco.name}.\nDança na chuva.`,
        instrument: "tuba",
        speech: "Cheguei!",
      });
    case "encounter":
      return ok(request, {
        type: "encounter",
        speech: `Oxe, ${request.other.name}, bora?`,
        affinity: true,
      });
    default:
      return;
  }
};

/** Taps the first option of the interview and skips the open question. */
const interviewOnly: Human = (view) => {
  if (!view.ask || view.ask.question.includes("bloco")) {
    return;
  }
  return view.ask.options.length > 0
    ? { askId: view.ask.id, choice: 0 }
    : { askId: view.ask.id, skip: true };
};

function sessions(world: World): string[] {
  return world.bonecos.flatMap((boneco) =>
    boneco.sessionId ? [boneco.sessionId] : []
  );
}

/** Steps the world `ms`, answering requests on the next tick. */
function run(
  world: World,
  ms: number,
  options: { brain?: Brain; human?: (session: string) => Human } = {}
) {
  const brain = options.brain ?? (() => undefined);
  let current = world;
  let results: BrainResult[] = [];
  const requests: DecisionRequest[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    const next = step(current, { elapsedMs: TICK_MS, results });
    current = next.world;
    requests.push(...next.requests);
    results = next.requests.flatMap((request) => brain(request) ?? []);
    for (const session of sessions(current)) {
      const view = privateView(current, session);
      const answer = view && options.human?.(session)(view);
      if (answer) {
        current = answerHuman(current, { sessionId: session, ...answer }).world;
      }
    }
  }
  return { world: current, requests };
}

function after(
  world: World,
  ms: number,
  options?: Parameters<typeof run>[2]
): World {
  return run(world, ms, options).world;
}

/**
 * A square in the `formar` phase: `humans` people who finished the interview
 * and `simulated` bonecos, all on the same spot unless a map is given.
 */
function square(options: {
  humans?: number;
  map?: WorldMap;
  rules?: Parameters<typeof createWorld>[0]["rules"];
  simulated?: number;
}): World {
  let { world } = step(
    createWorld({
      seed: 7,
      bonecos: options.simulated ?? 0,
      map: options.map ?? ONE_SPOT,
      rules: options.rules,
    }),
    { elapsedMs: TICK_MS, models: ["modelo-a"] }
  );
  for (let index = 0; index < (options.humans ?? 0); index += 1) {
    ({ world } = join(world, { sessionId: `sessao-${index + 1}` }));
  }
  world = after(world, 2000, {
    brain: friendly,
    human: () => interviewOnly,
  });
  for (const session of sessions(world)) {
    expect(privateView(world, session)?.interview?.done).toBe(true);
  }
  return enterFormar(world);
}

function phone(world: World, session: string): PrivateView {
  const view = privateView(world, session);
  if (!view) {
    throw new Error(`no view for ${session}`);
  }
  return view;
}

function nameOf(world: World, id: string): string {
  return world.bonecos.find((boneco) => boneco.id === id)?.name ?? id;
}

describe("encounters in the formar phase", () => {
  test("two bonecos without a bloco that come close say one line each and declare affinity", () => {
    const world = square({ humans: 2 });
    expect(publicSnapshot(world).phase).toBe("formar");
    const { world: met, requests } = run(world, 300, { brain: friendly });
    const encounters = requests.filter(
      (request): request is EncounterRequest => request.kind === "encounter"
    );
    expect(encounters).toHaveLength(2);
    const [first, second] = encounters as [EncounterRequest, EncounterRequest];
    expect(first.other.name).toBe(second.boneco.name);
    expect(second.other.name).toBe(first.boneco.name);
    // Each side reads the other's personality, from the interview.
    expect(first.other.personality?.[0]).toContain(second.boneco.name);

    const balloons = publicSnapshot(met).bonecos.map((boneco) => boneco.speech);
    expect(balloons).toContain(`Oxe, ${first.other.name}, bora?`);
    expect(balloons).toContain(`Oxe, ${second.other.name}, bora?`);

    // The phone shows whom the boneco talked to and what each one said.
    const view = phone(met, "sessao-1");
    expect(view.talks).toHaveLength(1);
    const [talk] = view.talks;
    expect(talk?.with.name).toBe(nameOf(met, "boneco-2"));
    expect(talk?.mine).toBe(`Oxe, ${nameOf(met, "boneco-2")}, bora?`);
    expect(talk?.theirs).toBe(`Oxe, ${nameOf(met, "boneco-1")}, bora?`);
    expect(talk?.liked).toBe(true);
  });
});

function encountersOf(requests: DecisionRequest[]): EncounterRequest[] {
  return requests.filter(
    (request): request is EncounterRequest => request.kind === "encounter"
  );
}

/** Likes nobody, so no invitation ever comes out of an encounter. */
const shy: Brain = (request) =>
  request.kind === "encounter"
    ? ok(request, { type: "encounter", speech: "Opa.", affinity: false })
    : friendly(request);

describe("the minimum interval between encounters of the same pair", () => {
  test("the same two meet again only after the interval", () => {
    const world = square({
      simulated: 2,
      rules: { meetCooldownMs: 5000 },
    });
    const first = run(world, 4000, { brain: shy });
    // One encounter: two requests, one per side; none again inside 5 s.
    expect(encountersOf(first.requests)).toHaveLength(2);
    const second = run(first.world, 2000, { brain: shy });
    expect(encountersOf(second.requests)).toHaveLength(2);
  });
});

describe("invitations and blocos", () => {
  test("a boneco that matched two others without a bloco invites them, and the bloco closes with exactly three", () => {
    const world = after(square({ simulated: 3 }), 2000, { brain: friendly });
    const snapshot = publicSnapshot(world);
    expect(snapshot.blocos).toHaveLength(1);
    const [bloco] = snapshot.blocos;
    expect(bloco?.members).toHaveLength(3);
    for (const boneco of snapshot.bonecos) {
      expect(boneco.bloco).toBe(bloco?.id ?? "");
    }
    const log = snapshot.events.map((event) => event.text).join("\n");
    expect(log).toContain("chamou");
    expect(log).toContain("Bloco 1 formado");
  });

  test("whoever is in a closed bloco gets no invitation and meets nobody", () => {
    const world = after(square({ simulated: 4 }), 3000, { brain: friendly });
    const snapshot = publicSnapshot(world);
    expect(snapshot.blocos).toHaveLength(1);
    expect(snapshot.blocos[0]?.members).toHaveLength(3);
    const outside = snapshot.bonecos.find((boneco) => boneco.bloco === null);
    expect(outside).toBeDefined();
    // The fourth liked the three, but they are taken: no invitation, no talk.
    const later = run(world, 20_000, { brain: friendly });
    expect(publicSnapshot(later.world).blocos).toHaveLength(1);
    const encounters = encountersOf(later.requests);
    expect(encounters).toHaveLength(0);
    const invitations = (w: World) =>
      w.events.filter((event) => event.text.includes("chamou")).length;
    expect(invitations(later.world)).toBe(invitations(world));
  });

  test("each human confirms by tap; the majority wins and whoever does not answer counts as yes", () => {
    const world = square({ humans: 3 });
    // Two say no: no bloco, and the same three are not invited again.
    const refused = after(world, 3000, {
      brain: friendly,
      human: (session) => (view) =>
        view.ask && session !== "sessao-1"
          ? { askId: view.ask.id, choice: 1 }
          : undefined,
    });
    expect(publicSnapshot(refused).blocos).toHaveLength(0);
    expect(refused.events.some((e) => e.text.includes("não vingou"))).toBe(
      true
    );

    // One says no, one says yes, one stays silent: the bloco closes.
    const asked = after(world, 300, { brain: friendly });
    for (const session of ["sessao-1", "sessao-2", "sessao-3"]) {
      expect(phone(asked, session).ask?.options).toEqual([
        "Bora!",
        "Agora não",
      ]);
    }
    const answers: Record<string, number | undefined> = {
      "sessao-1": 1,
      "sessao-2": 0,
    };
    const formed = after(asked, 13_000, {
      brain: friendly,
      human: (session) => (view) =>
        view.ask && answers[session] !== undefined
          ? { askId: view.ask.id, choice: answers[session] }
          : undefined,
    });
    expect(publicSnapshot(formed).blocos).toHaveLength(1);
    const silent = phone(formed, "sessao-3");
    expect(silent.thoughts.map((t) => t.text)).toContain(
      "O tempo acabou, então escolhi sozinho: Bora."
    );
  });

  test("the phone shows the other two of the bloco, with name and boneco", () => {
    const world = after(square({ humans: 3 }), 15_000, { brain: friendly });
    const view = phone(world, "sessao-1");
    expect(view.bloco?.mates.map((mate) => mate.name).sort()).toEqual(
      [nameOf(world, "boneco-2"), nameOf(world, "boneco-3")].sort()
    );
    for (const mate of view.bloco?.mates ?? []) {
      expect(typeof mate.look).toBe("number");
    }
  });

  test("when the brain fails, the encounter goes on autopilot and the boneco still likes the other", () => {
    const failing: Brain = (request) =>
      request.kind === "encounter"
        ? { ok: false, requestId: request.id, reason: "caiu" }
        : friendly(request);
    const world = after(square({ humans: 2 }), 300, { brain: failing });
    const view = phone(world, "sessao-1");
    expect(view.talks[0]?.liked).toBe(true);
    expect(view.talks[0]?.mine).toBeNull();
    expect(view.thoughts.at(-1)?.tone).toBe("aviso");
    // Nothing a model did not write reaches the telão.
    const balloons = publicSnapshot(world).bonecos.map((b) => b.speech);
    expect(balloons.some((text) => text?.includes("gente boa"))).toBe(false);
  });
});

/** The maestro's request among `requests`, when there is one. */
function maestroOf(requests: DecisionRequest[]): MaestroRequest | undefined {
  return requests.find(
    (request): request is MaestroRequest => request.kind === "maestro"
  );
}

/** Groups by the order of the names, in the sizes asked for. */
function maestroBrain(speech = "Bora, foliões!"): Brain {
  return (request) => {
    if (request.kind !== "maestro") {
      return shy(request);
    }
    const names = request.people.map((person) => person.name);
    const groups: string[][] = [];
    for (const size of request.sizes) {
      groups.push(names.splice(0, size));
    }
    return ok(request, { type: "maestro", groups, speech });
  };
}

function blocoSizes(world: World): number[] {
  return publicSnapshot(world)
    .blocos.map((bloco) => bloco.members.length)
    .sort();
}

function alone(world: World): string[] {
  return publicSnapshot(world)
    .bonecos.filter((boneco) => boneco.bloco === null)
    .map((boneco) => boneco.id);
}

describe("the maestro at the end of the phase", () => {
  test("groups whoever is left in one model call with every personality", () => {
    const world = after(square({ simulated: 6 }), 1000, { brain: shy });
    expect(publicSnapshot(world).blocos).toHaveLength(0);
    const { world: grouped, requests } = run(closeFormar(world), 500, {
      brain: maestroBrain(),
    });
    const maestros = requests.filter((request) => request.kind === "maestro");
    expect(maestros).toHaveLength(1);
    const maestro = maestroOf(requests) as MaestroRequest;
    expect(maestro.people).toHaveLength(6);
    expect(maestro.sizes).toEqual([3, 3]);
    // The blocos are the maestro's groups, in its order.
    const names = maestro.people.map((person) => person.name);
    const blocos = publicSnapshot(grouped).blocos.map((bloco) =>
      bloco.members.map((id) => nameOf(grouped, id))
    );
    expect(blocos).toEqual([names.slice(0, 3), names.slice(3)]);
    expect(alone(grouped)).toEqual([]);
    const log = publicSnapshot(grouped).events.map((event) => event.text);
    expect(log).toContain("Maestro (modelo-a): Bora, foliões!");
  });

  test("makes one bloco of four or of two when the count is not a multiple of three", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 10].map(sizesFor)).toEqual([
      [1],
      [2],
      [3],
      [4],
      [3, 2],
      [3, 3],
      [3, 4],
      [3, 3, 2],
      [3, 3, 4],
    ]);
    const seven = after(square({ simulated: 7 }), 1000, { brain: shy });
    const grouped7 = after(closeFormar(seven), 500, { brain: maestroBrain() });
    expect(blocoSizes(grouped7)).toEqual([3, 4]);
    const five = after(square({ simulated: 5 }), 1000, { brain: shy });
    const grouped5 = after(closeFormar(five), 500, { brain: maestroBrain() });
    expect(blocoSizes(grouped5)).toEqual([2, 3]);
    expect(alone(grouped5)).toEqual([]);
  });

  test("a maestro answer that does not split everyone exactly is not used", () => {
    const sloppy: Brain = (request) =>
      request.kind === "maestro"
        ? ok(request, {
            type: "maestro",
            groups: [request.people.slice(0, 3).map((p) => p.name)],
            speech: "Pronto!",
          })
        : shy(request);
    const world = after(square({ simulated: 6 }), 1000, { brain: shy });
    const grouped = after(closeFormar(world), 500, { brain: sloppy });
    expect(blocoSizes(grouped)).toEqual([3, 3]);
    expect(alone(grouped)).toEqual([]);
    const log = grouped.events.map((event) => event.text);
    expect(log).toContain(
      "O maestro não respondeu a tempo: juntei quem estava mais perto."
    );
  });

  describe("when the maestro fails, the square groups by distance on the map", () => {
    const sides: WorldMap = {
      width: 160,
      height: 90,
      places: [
        { id: "esquerda", name: "Esquerda", x: 10, y: 45 },
        { id: "direita", name: "Direita", x: 150, y: 45 },
      ],
    };
    /** The first three walk to the left, the others to the right. */
    const apart: Brain = (request) => {
      if (request.kind === undefined || request.kind === "walk") {
        const left = ["boneco-1", "boneco-2", "boneco-3"];
        return ok(request, {
          type: "walk",
          placeId: left.includes(request.boneco.id) ? "esquerda" : "direita",
          speech: "",
        });
      }
      return shy(request);
    };
    const spread = after(square({ simulated: 6, map: sides }), 30_000, {
      brain: apart,
    });

    function groups(world: World): string[][] {
      return publicSnapshot(world)
        .blocos.map((bloco) => [...bloco.members].sort())
        .sort();
    }
    const expected = [
      ["boneco-1", "boneco-2", "boneco-3"],
      ["boneco-4", "boneco-5", "boneco-6"],
    ];

    test("an error", () => {
      const failing: Brain = (request) =>
        request.kind === "maestro"
          ? { ok: false, requestId: request.id, reason: "caiu" }
          : apart(request);
      expect(
        groups(after(closeFormar(spread), 500, { brain: failing }))
      ).toEqual(expected);
    });

    test("no answer before its deadline", () => {
      const closed = closeFormar(spread);
      const waiting = after(closed, 5000, { brain: apart });
      expect(publicSnapshot(waiting).blocos).toHaveLength(0);
      expect(publicSnapshot(waiting).bonecos.every((b) => !b.walking)).toBe(
        true
      );
      const late = after(waiting, 6000, { brain: apart });
      expect(groups(late)).toEqual(expected);
    });

    test("no model in the Room", () => {
      const noModels = step(spread, { elapsedMs: TICK_MS, models: [] }).world;
      // A world without models keeps the last list; an empty Room is a new world.
      const empty = { ...noModels, models: [] };
      expect(groups(after(closeFormar(empty), 200))).toEqual(expected);
    });
  });

  test("an invitation still waiting when the phase ends counts the silent as yes", () => {
    const asked = after(square({ humans: 3 }), 300, { brain: friendly });
    expect(phone(asked, "sessao-1").ask).not.toBeNull();
    const closed = after(closeFormar(asked), 200, { brain: friendly });
    expect(blocoSizes(closed)).toEqual([3]);
    expect(phone(closed, "sessao-1").ask).toBeNull();
  });

  test("with nobody left, there is no maestro call", () => {
    const formed = after(square({ simulated: 3 }), 2000, { brain: friendly });
    const { requests } = run(closeFormar(formed), 1000, {
      brain: maestroBrain(),
    });
    expect(maestroOf(requests)).toBeUndefined();
  });
});

describe("late arrivals", () => {
  test("whoever arrives after the formar phase goes to the smallest bloco", () => {
    const seven = after(square({ simulated: 7 }), 1000, { brain: shy });
    const grouped = after(closeFormar(seven), 500, { brain: maestroBrain() });
    const smallest = publicSnapshot(grouped).blocos.find(
      (bloco) => bloco.members.length === 3
    );
    const arrived = join(grouped, { sessionId: "atrasada" });
    const placed = after(arrived.world, 200, { brain: friendly });
    expect(blocoSizes(placed)).toEqual([4, 4]);
    const view = phone(placed, "atrasada");
    expect(view.bloco?.id).toBe(smallest?.id ?? "");
    expect(view.bloco?.mates).toHaveLength(3);
    // The interview still runs for the late arrival.
    expect(view.interview?.done).toBe(false);
  });
});

describe("where blocos gather", () => {
  test("on the square, each bloco walks to its own meeting spot", () => {
    const square9 = square({
      simulated: 6,
      map: PRACA,
      rules: { meetRadius: 200 },
    });
    const formed = after(square9, 60_000, { brain: friendly });
    const { blocos } = publicSnapshot(formed);
    expect(blocos).toHaveLength(2);
    expect(blocos.map((bloco) => bloco.spot.id)).toEqual(
      MEETING_SPOTS.slice(0, 2).map((spot) => spot.id)
    );
    // Its members stand together around the spot, and stay there.
    for (const bloco of blocos) {
      for (const id of bloco.members) {
        const boneco = publicSnapshot(formed).bonecos.find((b) => b.id === id);
        expect(boneco?.walking).toBe(false);
        expect(Math.abs((boneco?.x ?? 0) - bloco.spot.x)).toBeLessThanOrEqual(
          6
        );
        expect(boneco?.y).toBe(bloco.spot.y);
      }
    }
  });
});

describe("when the host expels someone", () => {
  test("an expelled member leaves its bloco, and the others stay in it", () => {
    const formed = after(square({ simulated: 3 }), 2000, { brain: friendly });
    const [bloco] = publicSnapshot(formed).blocos;
    expect([...(bloco?.members ?? [])].sort()).toEqual([
      "boneco-1",
      "boneco-2",
      "boneco-3",
    ]);
    const { world } = expel(formed, "boneco-2");
    const members = () => [...(world.blocos[0]?.members ?? [])].sort();
    expect(members()).toEqual(["boneco-1", "boneco-3"]);
    expect(publicSnapshot(world).blocos[0]?.members).not.toContain("boneco-2");
    // The world keeps stepping without the one who left.
    const stayed = after(world, 200, { brain: friendly });
    expect(stayed.blocos[0]?.members).not.toContain("boneco-2");
  });

  test("an emptied bloco goes away and the next bloco does not reuse its mark", () => {
    const formed = after(square({ simulated: 3 }), 2000, { brain: friendly });
    let world = formed;
    for (const id of ["boneco-1", "boneco-2", "boneco-3"]) {
      ({ world } = expel(world, id));
    }
    expect(world.blocos).toEqual([]);
    for (let index = 0; index < 3; index += 1) {
      ({ world } = join(world, { sessionId: `nova-${index + 1}` }));
    }
    const yes: Human = (view) => {
      if (!view.ask) {
        return;
      }
      return view.ask.options.length > 0
        ? { askId: view.ask.id, choice: 0 }
        : { askId: view.ask.id, skip: true };
    };
    const again = after(world, 15_000, { brain: friendly, human: () => yes });
    expect(again.blocos.map((bloco) => [bloco.id, bloco.mark])).toEqual([
      ["bloco-2", 1],
    ]);
  });

  test("an invitation with the expelled one is called off for the others", () => {
    const asked = after(square({ humans: 3 }), 300, { brain: friendly });
    expect(phone(asked, "sessao-2").ask).not.toBeNull();
    const { world } = expel(asked, "boneco-1");
    for (const session of ["sessao-2", "sessao-3"]) {
      const view = phone(world, session);
      expect(view.ask).toBeNull();
      expect(view.thoughts.at(-1)?.text).toContain("O convite caiu");
    }
    // Closing the phase afterwards groups the two who are left.
    const closed = after(closeFormar(world), 200, { brain: friendly });
    expect(blocoSizes(closed)).toEqual([2]);
  });
});
