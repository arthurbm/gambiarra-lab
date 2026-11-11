// Credits for the art and the inspiration, for the final screen and anywhere
// else that shows them. The README of the experience says the same.

export interface Credit {
  /** Short address to show on a screen. */
  link: string;
  text: string;
  url: string;
}

export const CREDITS: readonly Credit[] = [
  {
    text: "Arte: Ninja Adventure, de Pixel-Boy e AAA (CC0)",
    link: "pixel-boy.itch.io/ninja-adventure-asset-pack",
    url: "https://pixel-boy.itch.io/ninja-adventure-asset-pack",
  },
  {
    text: "Inspirado no World de Filipe Calegario",
    link: "github.com/gambiarraclub/gambiarra-arena (MIT)",
    url: "https://github.com/gambiarraclub/gambiarra-arena",
  },
];

/** The same credits as plain text, two lines each. */
export const CREDITS_TEXT = CREDITS.map(
  (credit) => `${credit.text}\n${credit.link}`
).join("\n\n");
