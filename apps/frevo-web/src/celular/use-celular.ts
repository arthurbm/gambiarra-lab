// The phone's data: the session kept in the browser, the arrival, the
// private stream and the answers. A reload finds the session in storage and
// gets the same boneco back; a server that forgot the session (a restart)
// gets it again on the next arrival, and so does one the host restarted. A
// person the host expelled is told so and stays out, and so is a new person
// who arrives when the square is full.
import type { PhoneEvent, PhoneView } from "@gambiarra-lab/frevo/views";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectTelaoStream, type StreamStatus } from "../telao/stream";

const SESSION_KEY = "frevo-sessao";
const ENTER_RETRY_MS = 1500;

function storedSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function storeSession(session: string) {
  try {
    window.localStorage.setItem(SESSION_KEY, session);
  } catch {
    // Without storage a reload gives a new boneco; nothing else breaks.
  }
}

/** The square is full: the person watches on the telão instead. */
const FULL = "lotado";

async function enter(session: string | null): Promise<string | typeof FULL> {
  const response = await fetch("/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session ? { sessao: session } : {}),
  });
  if (response.status === 403 && session) {
    // Expelled: the session's stream tells the phone so.
    return session;
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as {
      lotado?: boolean;
    };
    if (body.lotado) {
      return FULL;
    }
  }
  if (!response.ok) {
    throw new Error(`entrar answered ${response.status}`);
  }
  const { sessao } = (await response.json()) as { sessao: string };
  storeSession(sessao);
  return sessao;
}

export interface Reply {
  digitando?: boolean;
  opcao?: number;
  pular?: boolean;
  texto?: string;
}

export function useCelular() {
  const [session, setSession] = useState<string | null>(null);
  const [view, setView] = useState<PhoneView | null>(null);
  const [expelled, setExpelled] = useState(false);
  const [full, setFull] = useState(false);
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
          const sessao = await enter(sessionRef.current ?? storedSession());
          if (sessao === FULL) {
            setFull(true);
            return;
          }
          sessionRef.current = sessao;
          setSession(sessao);
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, ENTER_RETRY_MS));
        }
      }
    })();
    return arriving.current;
  }, []);

  useEffect(() => {
    arrive();
  }, [arrive]);

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
            enter(session)
              .then((result) => setFull(result === FULL))
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
          enter(session).catch(() => undefined);
        }
      },
    });
  }, [session]);

  const reply = useCallback(
    async (askId: string, answer: Reply) => {
      if (!session) {
        return false;
      }
      try {
        const response = await fetch("/api/responder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessao: session, pergunta: askId, ...answer }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [session]
  );

  return { view, status, reply, receivedAt, expelled, full };
}
