import { describe, expect, test } from "bun:test";
import { filterModelText, isBlocked } from "./blocklist";

describe("the blocklist", () => {
  test("drops lines that call people by colour, race or body", () => {
    for (const line of [
      "E no recreio, oxe: que nêgo tu leva pra praia?",
      "Feira, puro nêgo!",
      "Pandeiro girando, nêgo no chão!",
      "Bora, nega, pro frevo",
      "Ô neguinho, vem cá",
      "Os neguinhos da praça",
      "Chega, negão!",
      "Vem, galeguinho",
      "Pretinha do bloco",
      "Mulata do frevo",
      "Ô gordinho, dança!",
      "Que rapariga arretada",
    ]) {
      expect(isBlocked(line)).toBe(true);
      expect(filterModelText(line, 140)).toBeNull();
    }
  });

  test("keeps innocent words that look alike", () => {
    for (const line of [
      "Fechei um negócio na feira",
      "Bora negociar a tapioca",
      "Tá alegre o bloco, que sossego",
      "Galera, bora pro Marco Zero",
      "Macaxeira com charque e morango",
      "Ele nunca vai negar um frevo",
      "Pregão do mercado e pretensão nenhuma",
      "Caboclinho e maracatu na rua",
    ]) {
      expect(isBlocked(line)).toBe(false);
    }
  });
});
