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

const FILE = /^\/files\/([\w-]+)\.mp3$/;
const QUEUED = /^\/q\/([\w-]+)(\/status|\/cancel)?$/;

interface Started {
  at: number;
  behavior: FakeFalBehavior;
}

function isDone({ behavior, at }: Started): boolean {
  if (behavior.kind === "slow" || behavior.kind === "refused") {
    return false;
  }
  return Date.now() - at >= (behavior.ms ?? 0);
}

/** Status, cancel or result of a queued request. */
function queuedAnswer(
  entry: Started,
  id: string,
  action: string | undefined,
  base: string,
  cancelled: string[]
): Response {
  if (action === "/cancel") {
    cancelled.push(id);
    return Response.json({ status: "CANCELLATION_REQUESTED" });
  }
  if (action === "/status") {
    return Response.json({
      status: isDone(entry) ? "COMPLETED" : "IN_PROGRESS",
    });
  }
  if (entry.behavior.kind === "error") {
    return Response.json(
      { detail: "downstream_service_unavailable" },
      { status: entry.behavior.status ?? 504 }
    );
  }
  return Response.json({
    audio: { url: `${base}/files/${id}.mp3`, content_type: "audio/mpeg" },
  });
}

export function startFakeFal(options: {
  behaviors: Record<string, FakeFalBehavior>;
}): FakeFal {
  const requests: FakeFalRequest[] = [];
  const cancelled: string[] = [];
  const started = new Map<string, Started>();
  let count = 0;

  async function submit(request: Request, endpoint: string, base: string) {
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
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Promise<Response> | Response {
      const { pathname, origin } = new URL(request.url);
      if (FILE.test(pathname) && request.method === "GET") {
        return new Response(FAKE_AUDIO, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      const queued = QUEUED.exec(pathname);
      if (queued) {
        const id = queued[1] ?? "";
        const entry = started.get(id);
        return entry
          ? queuedAnswer(entry, id, queued[2], origin, cancelled)
          : new Response("not found", { status: 404 });
      }
      return request.method === "POST"
        ? submit(request, pathname.slice(1), origin)
        : new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    cancelled,
    stop: () => server.stop(true),
  };
}
