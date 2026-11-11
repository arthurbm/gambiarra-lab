import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_BOARD_DATABASE_URL = `file:${fileURLToPath(
  new URL("../data/board.db", import.meta.url)
)}`;

const envSchema = z.object({
  BOARD_ADMIN_TOKEN: z.string().min(8).default("gambi-local-admin"),
  BOARD_DATABASE_URL: z.string().default(DEFAULT_BOARD_DATABASE_URL),
  BOARD_HOST: z.string().default("0.0.0.0"),
  // 0 asks the OS for a free port; the startup line prints the real one.
  BOARD_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
});

export function readBoardEnv(
  source: Record<string, string | undefined> = process.env
) {
  return envSchema.parse(source);
}
