// A development tool: the telão fed by the real simulation running in the
// browser, with 30 bonecos and a fake brain that answers after a random delay.
// It shows the art at full load without a hub or models. Open /telao/demo;
// `?blocos` sends bonecos to the meeting spots, `?bonecos=12` changes the count.
import { MEETING_SPOTS } from "@gambiarra-lab/frevo/meeting-spots";
import {
  type BrainResult,
  createWorld,
  type DecisionRequest,
  PRACA,
  type PublicSnapshot,
  publicSnapshot,
  step,
  type WorldMap,
} from "@gambiarra-lab/frevo/snapshot";
import { useEffect, useState } from "react";
import { BonecoSprite } from "../art/boneco-sprite";
import { INSTRUMENTS } from "../art/characters";
import { TelaoLayout } from "./telao-page";
import type { ArtBoneco } from "./world-view";

const TICK_MS = 100;
const PUBLISH_MS = 200;
const NAMES = [
  "Capiba",
  "Lia",
  "Naná",
  "Chico",
  "Alceu",
  "Dona Santa",
  "Nelson",
  "Lenine",
  "Clarice",
  "Zuzinha",
  "Spok",
  "Getúlio",
  "Duda",
  "Marisa",
  "Selma",
  "Siba",
  "Karina",
  "Otto",
  "Isaar",
  "Mestre Salu",
  "Ivete",
  "Juvenal",
  "Bia",
  "Rosa",
  "Toinho",
  "Cida",
  "Biu",
  "Neném",
  "Joana",
  "Severino",
];
const LINES = [
  "Bora pro Marco Zero!",
  "Quem tem sombrinha vem comigo",
  "Ouvi um trombone lá na ponte",
  "Vou atrás do cheiro de tapioca",
  "Esse passo eu aprendi com meu avô",
  "O palco tá chamando a gente",
  "Alguém viu o pessoal do surdo?",
  "Frevo é pra ferver, minha gente!",
  "Vou na fonte molhar o pé e já volto pra dançar mais um pouco",
  "Quero um bloco com nome de passarinho",
];

function demoMap(blocos: boolean): WorldMap {
  if (!blocos) {
    return PRACA;
  }
  return {
    ...PRACA,
    places: MEETING_SPOTS.map((spot, index) => ({
      ...spot,
      name: `Ponto ${index + 1}`,
    })),
  };
}

function dress(snapshot: PublicSnapshot): PublicSnapshot {
  return {
    ...snapshot,
    bonecos: snapshot.bonecos.map(
      (boneco, index): ArtBoneco => ({
        ...boneco,
        name: NAMES[index % NAMES.length] ?? boneco.name,
        look: index,
        instrument: index % 4 === 3 ? null : (INSTRUMENTS[index % 8] ?? null),
      })
    ),
  };
}

function useDemoWorld(count: number, blocos: boolean) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  useEffect(() => {
    let world = createWorld({ bonecos: count, seed: 7, map: demoMap(blocos) });
    let clock = 0;
    let answers: Array<{ at: number; result: BrainResult }> = [];
    let seed = 11;
    const roll = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const answer = (request: DecisionRequest) => {
      const others = request.places.filter(
        (candidate) => candidate.id !== request.placeId
      );
      const place = others[Math.floor(roll() * others.length)];
      answers.push({
        at: clock + 400 + roll() * 5000,
        result: place
          ? {
              ok: true,
              requestId: request.id,
              model: "modelo-falso",
              action: {
                type: "walk",
                placeId: place.id,
                speech: LINES[Math.floor(roll() * LINES.length)] ?? "",
              },
            }
          : { ok: false, requestId: request.id, reason: "no place" },
      });
    };
    const tick = setInterval(() => {
      clock += TICK_MS;
      const due = answers.filter((pending) => pending.at <= clock);
      answers = answers.filter((pending) => pending.at > clock);
      const next = step(world, {
        elapsedMs: TICK_MS,
        results: due.map((pending) => pending.result),
      });
      ({ world } = next);
      for (const request of next.requests) {
        answer(request);
      }
    }, TICK_MS);
    const publish = setInterval(
      () => setSnapshot(dress(publicSnapshot(world))),
      PUBLISH_MS
    );
    return () => {
      clearInterval(tick);
      clearInterval(publish);
    };
  }, [count, blocos]);
  return snapshot;
}

export function TelaoDemoPage() {
  const { search } = window.location;
  const params = new URLSearchParams(search);
  const count = Math.min(60, Math.max(1, Number(params.get("bonecos")) || 30));
  const snapshot = useDemoWorld(count, params.has("blocos"));
  return (
    <TelaoLayout snapshot={snapshot} status="live">
      <section className="telao-demo">
        <p>Demonstração local: simulação no navegador, cérebro falso.</p>
        <div className="telao-demo-sprites">
          {INSTRUMENTS.map((instrument, index) => (
            <BonecoSprite
              instrument={instrument}
              key={instrument}
              label={instrument}
              look={index * 3}
              scale={3}
              walking={index % 2 === 0}
            />
          ))}
        </div>
      </section>
    </TelaoLayout>
  );
}
