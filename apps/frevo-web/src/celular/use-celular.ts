// The phone's data: the session kept in the browser, the arrival, the
// private stream and the answers. A first visit waits for the person to say
// their name (or ask for a drawn one) before it enters; the name is kept with
// the session. A reload finds the session in storage and
// gets the same boneco back; a server that forgot the session (a restart)
// gets it again on the next arrival, and so does one the host restarted. A
// person the host expelled is told so and stays out, and so is a new person
// who arrives when the square is full.
import type { PhoneEvent, PhoneView } from "@gambiarra-lab/frevo/views";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectTelaoStream, type StreamStatus } from "../telao/stream";

const SESSION_KEY = "frevo-sessao";
/** The name the person gave; a new boneco after a restart gets it again. */
const NAME_KEY = "frevo-nome";
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
type Entered =
  | { erro: string; kind: typeof REFUSED }
  | { kind: "entrou"; sessao: string }
  | { kind: typeof FULL };

async function enter(
  session: string | null,
  name: string | null
): Promise<Entered> {
  const response = await fetch("/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(session ? { sessao: session } : {}),
      ...(name ? { nome: name } : {}),
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
    };
    if (body.lotado) {
      return { kind: FULL };
    }
    if (body.nomeRecusado) {
      return { kind: REFUSED, erro: body.erro ?? "Tente outro nome." };
    }
  }
  if (!response.ok) {
    throw new Error(`entrar answered ${response.status}`);
  }
  const { sessao } = (await response.json()) as { sessao: string };
  store(SESSION_KEY, sessao);
  return { kind: "entrou", sessao };
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
  const reentering = useRef(false);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  /** When the view arrived, to run the countdown on this phone's clock. */
  const receivedAt = useRef(0);
  const sessionRef = useRef<string | null>(null);

  /** The arrival in flight: React runs the effect twice in development. */
  const arriving = useRef<Promise<void> | null>(null);

  const arrive = useCallback(() => {
    arriving.current ??= (async () => {
      for (;;) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: tries again until the world answers.
          const entered = await enter(
            sessionRef.current ?? stored(SESSION_KEY),
            stored(NAME_KEY)
          );
          if (entered.kind === REFUSED) {
            // Back to the welcome, to pick another name.
            store(NAME_KEY, null);
            setNameError(entered.erro);
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

  /** The welcome's answer: a name, or null for a drawn one. */
  const start = useCallback(
    (name: string | null) => {
      setNameError(null);
      store(NAME_KEY, name?.trim() || null);
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
        if ("reiniciou" in next) {
          // The host started over: come back with a new boneco.
          setView(null);
          // Several notices may arrive before the new boneco does.
          if (reentering.current === false) {
            reentering.current = true;
            enter(session, stored(NAME_KEY))
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
        if (next === "reconnecting") {
          enter(session, stored(NAME_KEY)).catch(() => undefined);
        }
      },
    });
  }, [session]);

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

  return {
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
