// The music of a chosen bloco, behind one function: the bloco's name, its
// refrain and a style in, the address of an audio file out. The default
// answers with a track that ships with the web; a generator that calls a
// music model replaces it without the rest of the server noticing.

export type MusicGenerator = (input: {
  blocoName: string;
  refrain: string[];
  style: string;
}) => Promise<{ url: string }>;

/** Served by the web from `public/audio/`. */
export const EMBEDDED_TRACK = "/audio/reserva-2.mp3";

/**
 * Frevo described by instrumentation and tempo, which is what the music
 * models follow (see the notes of the music exploration).
 */
export const FREVO_STYLE =
  "Frevo-canção from Recife, Pernambuco, Brazilian carnival street brass orchestra. Bright trumpets, trombones, saxophones, tuba marching bass line, snare drum (caixa) rolls and surdo marking a 2/4 march beat. Very fast, about 150 BPM, 2/4 time, major key, euphoric and festive.";

export const embeddedMusic: MusicGenerator = () =>
  Promise.resolve({ url: EMBEDDED_TRACK });
