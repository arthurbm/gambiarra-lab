// The phone's data: the session kept in the browser, the arrival, the
// private stream and the answers. A first visit waits for the person to say
// their name (or ask for a drawn one) and pick a boneco (or let one be drawn)
// before it enters; both are kept with the session. A boneco someone else took
// meanwhile sends the person back to the welcome with the name kept. A reload finds the session in storage and
// gets the same boneco back; a server that forgot the session (a restart)
// gets it again on the next arrival, and so does one the host restarted. A
// person the host expelled is told so and stays out, and so is a new person
// who arrives when the square is full. A person who leaves from the phone
// forgets the session and is back at the welcome, name filled in, as if they
// had just scanned the QR.
import type { PhoneEvent, PhoneView } from "@gambiarra-lab/frevo/views";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectTelaoStream, type StreamStatus } from "../telao/stream";

const SESSION_KEY = "frevo-sessao";
/** The name the person gave; a new boneco after a restart gets it again. */
const NAME_KEY = "frevo-nome";
/** The boneco the person picked, likewise; absent when they let it be drawn. */
const LOOK_KEY = "frevo-visual";
const ENTER_RETRY_MS = 1500;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Without storage a reload gives a new boneco; nothing else breaks.
  }
}

/** The square is full: the person watches on the telão instead. */
const FULL = "lotado";
/** The server refused the name the person typed. */
const REFUSED = "nome-recusado";
/** Someone already wears the boneco the person picked. */
const LOOK_TAKEN = "visual-ocupado";
type Entered =
  | { erro: string; kind: typeof LOOK_TAKEN }
  | { erro: string; kind: typeof REFUSED }
  | { kind: "entrou"; sessao: string }
  | { kind: typeof FULL };

/** The look the person picked, kept as text; null lets the world draw one. */
function storedLook(): number | null {
  const look = Number(stored(LOOK_KEY) ?? Number.NaN);
  return Number.isInteger(look) && look >= 0 ? look : null;
}

async function enter(
  session: string | null,
  name: string | null,
  look: number | null
): Promise<Entered> {
  const response = await fetch("/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(session ? { sessao: session } : {}),
      ...(name ? { nome: name } : {}),
      ...(look === null ? {} : { look }),
    }),
  });
  if (response.status === 403 && session) {
    // Expelled: the session's stream tells the phone so.
    return { kind: "entrou", sessao: session };
  }
  if (response.status === 409 || response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as {
      erro?: string;
      lotado?: boolean;
      nomeRecusado?: boolean;
      visualOcupado?: boolean;
    };
    if (body.lotado) {
      return { kind: FULL };
    }
    if (body.nomeRecusado) {
      return { kind: REFUSED, erro: body.erro ?? "Tente outro nome." };
    }
    if (body.visualOcupado) {
      return { kind: LOOK_TAKEN, erro: body.erro ?? "Escolha outro boneco." };
    }
  }
  if (!response.ok) {
    throw new Error(`entrar answered ${response.status}`);
  }
  const { sessao } = (await response.json()) as { sessao: string };
  store(SESSION_KEY, sessao);
  return { kind: "entrou", sessao };
}

/**
 * Entering again without the person on the welcome (a restart, a server that
 * forgot the session): when someone else took their boneco meanwhile, a drawn
 * one is better than a phone stuck outside.
 */
async function enterAgain(
  session: string,
  name: string | null,
  look: number | null
): Promise<Entered> {
  const entered = await enter(session, name, look);
  return entered.kind === LOOK_TAKEN ? enter(session, name, null) : entered;
}

export interface Reply {
  digitando?: boolean;
  opcao?: number;
  pular?: boolean;
  texto?: string;
}

/** Whether the server took an answer, and why not when it says so. */
export interface Replied {
  erro?: string;
  ok: boolean;
}

export function useCelular() {
  const [session, setSession] = useState<string | null>(null);
  const [view, setView] = useState<PhoneView | null>(null);
  const [expelled, setExpelled] = useState(false);
  const [full, setFull] = useState(false);
  /** A first visit: nobody enters before saying how they want to be called. */
  const [welcome, setWelcome] = useState(() => stored(SESSION_KEY) === null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [lookError, setLookError] = useState<string | null>(null);
  const reentering = useRef(false);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  /** When the view arrived, to run the countdown on this phone's clock. */
  const receivedAt = useRef(0);
  const sessionRef = useRef<string | null>(null);
  /** The name as typed: storage only keeps it for the next visit. */
  const nameRef = useRef<string | null>(stored(NAME_KEY));
  /** The boneco as picked; null lets the world draw one. */
  const lookRef = useRef<number | null>(storedLook());

  /** Leaving: nothing may enter again with the session being dropped. */
  const leaving = useRef<boolean>(false);

  /** The arrival in flight: React runs the effect twice in development. */
  const arriving = useRef<Promise<void> | null>(null);

  const arrive = useCallback(() => {
    arriving.current ??= (async () => {
      for (;;) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: tries again until the world answers.
          const entered = await enter(
            sessionRef.current ?? stored(SESSION_KEY),
            nameRef.current,
            lookRef.current
          );
          if (entered.kind === REFUSED) {
            // Back to the welcome, to pick another name.
            nameRef.current = null;
            store(NAME_KEY, null);
            setNameError(entered.erro);
            setWelcome(true);
            arriving.current = null;
            return;
          }
          if (entered.kind === LOOK_TAKEN) {
            // Back to the welcome, name kept, to pick another boneco.
            lookRef.current = null;
            store(LOOK_KEY, null);
            setLookError(entered.erro);
            setWelcome(true);
            arriving.current = null;
            return;
          }
          setWelcome(false);
          if (entered.kind === FULL) {
            setFull(true);
            return;
          }
          sessionRef.current = entered.sessao;
          setSession(entered.sessao);
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, ENTER_RETRY_MS));
        }
      }
    })();
    return arriving.current;
  }, []);

  /** Someone who was here before comes straight back to their boneco. */
  useEffect(() => {
    if (stored(SESSION_KEY) !== null) {
      arrive();
    }
  }, [arrive]);

  /** Back to a first visit: no session, no boneco, the welcome on screen. */
  const forget = useCallback(() => {
    store(SESSION_KEY, null);
    sessionRef.current = null;
    arriving.current = null;
    setSession(null);
    setView(null);
    setFull(false);
    setExpelled(false);
    setNameError(null);
    setLookError(null);
    setWelcome(true);
  }, []);

  /**
   * The welcome's answer: a name, or null for a drawn one, and a look, or
   * null for a drawn one.
   */
  const start = useCallback(
    (name: string | null, look: number | null) => {
      leaving.current = false;
      setNameError(null);
      setLookError(null);
      nameRef.current = name?.trim() || null;
      store(NAME_KEY, nameRef.current);
      lookRef.current = look;
      store(LOOK_KEY, look === null ? null : String(look));
      return arrive();
    },
    [arrive]
  );

  useEffect(() => {
    if (!session) {
      return;
    }
    return connectTelaoStream<PhoneEvent>({
      url: `/events/celular?sessao=${encodeURIComponent(session)}`,
      onSnapshot: (next) => {
        if ("expulso" in next) {
          setExpelled(true);
          return;
        }
        if ("saiu" in next) {
          // The person left, from this tab or another one.
          leaving.current = true;
          forget();
          return;
        }
        if (leaving.current) {
          return;
        }
        if ("reiniciou" in next) {
          // The host started over: come back with a new boneco.
          setView(null);
          // Several notices may arrive before the new boneco does.
          if (reentering.current === false) {
            reentering.current = true;
            enterAgain(session, nameRef.current, lookRef.current)
              .then((result) => setFull(result.kind === FULL))
              .catch(() => undefined)
              .finally(() => {
                reentering.current = false;
              });
          }
          return;
        }
        setExpelled(false);
        receivedAt.current = Date.now();
        setView(next);
      },
      onStatus: (next) => {
        setStatus(next);
        // The server may have restarted and forgotten the session.
        if (next === "reconnecting" && !leaving.current) {
          enterAgain(session, nameRef.current, lookRef.current).catch(
            () => undefined
          );
        }
      },
    });
  }, [session, forget]);

  const reply = useCallback(
    async (askId: string, answer: Reply): Promise<Replied> => {
      if (!session) {
        return { ok: false };
      }
      try {
        const response = await fetch("/api/responder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessao: session, pergunta: askId, ...answer }),
        });
        if (response.ok) {
          return { ok: true };
        }
        const body = (await response.json().catch(() => ({}))) as {
          erro?: string;
        };
        return { ok: false, erro: body.erro };
      } catch {
        return { ok: false, erro: "Sem conexão. Tente de novo." };
      }
    },
    [session]
  );

  /** The person leaves the square: the boneco goes, the phone starts over. */
  const leave = useCallback(async (): Promise<Replied> => {
    const { current } = sessionRef;
    if (!current) {
      forget();
      return { ok: true };
    }
    leaving.current = true;
    try {
      const response = await fetch("/api/sair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessao: current }),
      });
      // 404: the boneco was already gone (a restart); starting over is right.
      if (response.ok || response.status === 404) {
        forget();
        return { ok: true };
      }
      leaving.current = false;
      const body = (await response.json().catch(() => ({}))) as {
        erro?: string;
      };
      return {
        ok: false,
        erro: body.erro ?? "Não deu para sair. Tente de novo.",
      };
    } catch {
      leaving.current = false;
      return { ok: false, erro: "Sem conexão. Tente de novo." };
    }
  }, [forget]);

  return {
    leave,
    /** The name typed last, to fill the welcome again after leaving. */
    lastName: nameRef.current,
    /** The boneco picked last, likewise; null when it was drawn. */
    lastLook: lookRef.current,
    lookError,
    view,
    status,
    reply,
    receivedAt,
    expelled,
    full,
    welcome,
    nameError,
    start,
  };
}
