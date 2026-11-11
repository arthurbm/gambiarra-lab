// The admin's data: the host's state streamed from the server and the
// actions. The secret comes from the link (`/admin?k=<secret>`) and goes only
// in the Authorization header; the stream is read with fetch for that reason,
// since EventSource cannot send headers.
import type { AdminState } from "@gambiarra-lab/frevo/views";
import { useCallback, useEffect, useState } from "react";

export type AdminConnection = "connecting" | "denied" | "live" | "reconnecting";

const RETRY_MS = 1000;
/** The server sends the state twice a second; silence this long is a drop. */
const STALE_MS = 5000;

export function adminSecret(): string | null {
  return new URLSearchParams(window.location.search).get("k");
}

function parseBlocks(text: string): { events: string[]; rest: string } {
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
    )
    .filter(Boolean);
  return { events, rest };
}

export function useAdmin(secret: string) {
  const [state, setState] = useState<AdminState | null>(null);
  const [connection, setConnection] = useState<AdminConnection>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let abort: AbortController | undefined;
    let stale: ReturnType<typeof setTimeout> | undefined;

    function watchSilence() {
      clearTimeout(stale);
      stale = setTimeout(() => abort?.abort(), STALE_MS);
    }

    async function readOnce() {
      abort = new AbortController();
      watchSilence();
      const response = await fetch("/api/admin/eventos", {
        headers: { Authorization: `Bearer ${secret}` },
        signal: abort.signal,
      });
      if (response.status === 401) {
        stopped = true;
        setConnection("denied");
        return;
      }
      if (!(response.ok && response.body)) {
        throw new Error(`eventos answered ${response.status}`);
      }
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let pending = "";
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: the stream is read in order.
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        watchSilence();
        const parsed = parseBlocks(pending + value);
        pending = parsed.rest;
        const last = parsed.events.at(-1);
        if (last) {
          setConnection("live");
          setState(JSON.parse(last) as AdminState);
        }
      }
    }

    async function loop() {
      while (!stopped) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: one connection at a time.
          await readOnce();
        } catch {
          // Dropped or silent: connect again below.
        }
        if (!stopped) {
          setConnection("reconnecting");
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    }

    loop();
    return () => {
      stopped = true;
      clearTimeout(stale);
      abort?.abort();
    };
  }, [secret]);

  const act = useCallback(
    async (route: string, body: Record<string, unknown> = {}) => {
      try {
        const response = await fetch(`/api/admin/${route}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (response.status === 401) {
          setConnection("denied");
          return false;
        }
        if (!response.ok) {
          const answer = (await response.json().catch(() => ({}))) as {
            erro?: string;
          };
          setError(answer.erro ?? `O servidor respondeu ${response.status}.`);
          return false;
        }
        setError(null);
        setState((await response.json()) as AdminState);
        return true;
      } catch {
        setError("Sem conexão com o servidor. Tente de novo.");
        return false;
      }
    },
    [secret]
  );

  return { state, connection, error, act };
}
