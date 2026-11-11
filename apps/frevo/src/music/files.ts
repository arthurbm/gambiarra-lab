// The generated music, kept in memory and served by the world itself, so the
// telão never depends on the music service's address staying valid or on its
// CORS. A few tracks of half a megabyte each; they last as long as the server.
import { randomBytes } from "node:crypto";

/** Where the world serves the copies; the web forwards `/api` to the world. */
export const MUSIC_PATH = "/api/musica/";

const FILE = /^\/api\/musica\/([a-f0-9]{16})\.mp3$/;

export interface MusicFile {
  bytes: Uint8Array;
  type: string;
}

export interface MusicFiles {
  /** The copy at this path, if there is one. */
  get: (path: string) => MusicFile | undefined;
  /** Keeps the audio and answers the path that serves it. */
  put: (file: MusicFile) => string;
}

export function createMusicFiles(): MusicFiles {
  const files = new Map<string, MusicFile>();
  return {
    put(file) {
      const id = randomBytes(8).toString("hex");
      files.set(id, file);
      return `${MUSIC_PATH}${id}.mp3`;
    },
    get(path) {
      const id = FILE.exec(path)?.[1];
      return id ? files.get(id) : undefined;
    },
  };
}
