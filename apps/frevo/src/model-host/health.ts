// The model host's only HTTP route: GET /health, for the platform's
// healthcheck. It answers 200 while the process runs, even before the Room
// exists (the world creates it), and says how many participants joined.
import type { ModelHost } from "./host";

export interface HealthServer {
  port: number;
  stop: () => Promise<void>;
}

export function serveModelHostHealth(
  host: Pick<ModelHost, "joined" | "participantIds">,
  options: { host?: string; port?: number } = {}
): HealthServer {
  const server = Bun.serve({
    // `::` takes IPv6 and IPv4; Railway's private network needs IPv6.
    hostname: options.host ?? "::",
    port: options.port ?? 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/health") {
        return new Response("Not Found", { status: 404 });
      }
      return Response.json({
        ok: true,
        participants: host.participantIds.length,
        joined: host.joined(),
      });
    },
  });
  return {
    port: server.port as number,
    stop: () => server.stop(true),
  };
}
