import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestDatabase {
  /** Removes the database file and its temporary directory. */
  cleanup: () => Promise<void>;
  /** A `file:` URL that no other test shares. */
  url: string;
}

/**
 * Gives a board test its own database file. The in-memory URL is a single
 * shared-cache database for the whole test process, so state written by one
 * test file leaks into another depending on file order. libSQL rejects
 * `?mode=memory`, so a named in-memory database per call is not an option.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "gambi-board-test-"));
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    url: `file:${join(directory, "board.db")}`,
  };
}
