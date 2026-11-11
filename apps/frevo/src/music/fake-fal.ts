// A fake fal.ai queue on a free local port, for tests: submit, status, result,
// cancel and the audio file, with each endpoint answering well, failing, being
// refused or never finishing. It never touches the network.

export type FakeFalBehavior =
  /** Completes after `ms` with an audio file. */
  | { kind: "ok"; ms?: number }
  /** Completes after `ms`, and the result answers this HTTP status (fal's 504). */
  | { kind: "error"; ms?: number; status?: number }
  /** Stays IN_PROGRESS forever. */
  | { kind: "slow" }
  /** The submit itself answers this HTTP status. */
  | { kind: "refused"; status?: number };

export interface FakeFalRequest {
  authorization: string | null;
  endpoint: string;
  id: string;
  input: Record<string, unknown>;
}

export interface FakeFal {
  /** Request ids that were cancelled. */
  cancelled: string[];
  requests: FakeFalRequest[];
  stop: () => void;
  url: string;
}

/** A few bytes that start like an MP3 file. */
export const FAKE_AUDIO = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb,
]);

export function startFakeFal(options: {
  behaviors: Record<string, FakeFalBehavior>;
}): FakeFal {
  const requests: FakeFalRequest[] = [];
  const cancelled: string[] = [];
  const started = new Map<string, { behavior: FakeFalBehavior; at: number }>();
  let count = 0;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const base = `http://127.0.0.1:${server.port}`;
      const file = /^\/files\/([\w-]+)\.mp3$/.exec(pathname);
      if (file && request.method === "GET") {
        return new Response(FAKE_AUDIO, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      const queued = /^\/q\/([\w-]+)(\/status|\/cancel)?$/.exec(pathname);
      if (queued) {
        const id = queued[1] ?? "";
        const entry = started.get(id);
        if (!entry) {
          return new Response("not found", { status: 404 });
        }
        if (queued[2] === "/cancel") {
          cancelled.push(id);
          return Response.json({ status: "CANCELLATION_REQUESTED" });
        }
        const { behavior, at } = entry;
        const done =
          behavior.kind !== "slow" &&
          Date.now() - at >= ("ms" in behavior ? (behavior.ms ?? 0) : 0);
        if (queued[2] === "/status") {
          return Response.json({ status: done ? "COMPLETED" : "IN_PROGRESS" });
        }
        if (behavior.kind === "error") {
          return Response.json(
            { detail: "downstream_service_unavailable" },
            { status: behavior.status ?? 504 }
          );
        }
        return Response.json({
          audio: { url: `${base}/files/${id}.mp3`, content_type: "audio/mpeg" },
        });
      }
      if (request.method !== "POST") {
        return new Response("not found", { status: 404 });
      }
      const endpoint = pathname.slice(1);
      const behavior = options.behaviors[endpoint];
      if (!behavior) {
        return new Response("unknown endpoint", { status: 404 });
      }
      const input = (await request.json()) as Record<string, unknown>;
      count += 1;
      const id = `req-${count}`;
      requests.push({
        id,
        endpoint,
        input,
        authorization: request.headers.get("authorization"),
      });
      if (behavior.kind === "refused") {
        return Response.json(
          { detail: "refused" },
          { status: behavior.status ?? 500 }
        );
      }
      started.set(id, { behavior, at: Date.now() });
      return Response.json({
        request_id: id,
        status: "IN_QUEUE",
        status_url: `${base}/q/${id}/status`,
        response_url: `${base}/q/${id}`,
        cancel_url: `${base}/q/${id}/cancel`,
      });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    cancelled,
    stop: () => server.stop(true),
  };
}
