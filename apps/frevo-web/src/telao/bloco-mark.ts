// The colour that marks each bloco, on the telão and on the phones. Blocos are
// numbered in the order they formed; the colours repeat after the list ends.
const BLOCO_COLORS = [
  "#ff4f5e",
  "#ffd23f",
  "#3bceac",
  "#5b8def",
  "#f78c1f",
  "#b983ff",
  "#ff8fc7",
  "#9be15d",
  "#4fd1ff",
  "#e0e0e0",
];

export function blocoColor(mark: number): string {
  return BLOCO_COLORS[mark % BLOCO_COLORS.length] as string;
}

export function blocoLabel(mark: number): string {
  return `Bloco ${mark + 1}`;
}
