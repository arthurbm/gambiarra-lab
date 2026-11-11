// The phone's data: the session kept in the browser, the arrival, the
// private stream and the answers. A reload finds the session in storage and
// gets the same boneco back; a server that forgot the session (a restart)
// gets it again on the next arrival.
import type { PrivateView } from "@gambiarra-lab/frevo/snapshot";
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

async function enter(session: string | null): Promise<string> {
  const response = await fetch("/api/entrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session ? { sessao: session } : {}),
  });
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
  const [view, setView] = useState<PrivateView | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  /** When the view arrived, to run the countdown on this phone's clock. */
  const receivedAt = useRef(0);
  const sessionRef = useRef<string | null>(null);

  const arrive = useCallback(async () => {
    for (;;) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: tries again until the world answers.
        const sessao = await enter(sessionRef.current ?? storedSession());
        sessionRef.current = sessao;
        setSession(sessao);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, ENTER_RETRY_MS));
      }
    }
  }, []);

  useEffect(() => {
    arrive();
  }, [arrive]);

  useEffect(() => {
    if (!session) {
      return;
    }
    return connectTelaoStream<PrivateView>({
      url: `/events/celular?sessao=${encodeURIComponent(session)}`,
      onSnapshot: (next) => {
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

  return { view, status, reply, receivedAt };
}
