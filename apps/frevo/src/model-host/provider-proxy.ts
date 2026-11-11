// A local endpoint between the model participants and the provider. Each
// participant points at it; it merges the per-model request fields of the
// catalog (reasoning at its minimum, the tool forced, max_tokens, provider
// routing) over what came through the hub, and adds the provider's key. So the
// key and the provider's quirks stay in the model host, whatever the hub does
// with the fields it forwards.
import { requestFor } from "../models/catalog";
import type { Upstream } from "./host";

export interface ProviderProxy {
  /** Base URL, without `/v1`, as createParticipantSession expects. */
  endpoint: string;
  stop: () => void;
}

export function startProviderProxy(options: {
  models: string[];
  upstream: Upstream;
}): ProviderProxy {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // A slow provider must not be cut by Bun's idle timeout.
    idleTimeout: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: options.models.map((id) => ({
            id,
            object: "model",
            owned_by: "frevo",
          })),
        });
      }
      if (request.method !== "POST" || pathname !== "/v1/chat/completions") {
        return new Response("Not Found", { status: 404 });
      }
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      // The SDK probes the endpoint with an empty body before joining; the
      // provider is not bothered with it.
      if (!Array.isArray(body.messages)) {
        return Response.json(
          { error: { message: "messages is required" } },
          { status: 400 }
        );
      }
      try {
        const answer = await fetch(
          `${options.upstream.endpoint}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...options.upstream.authHeaders,
            },
            body: JSON.stringify(requestFor(String(body.model), body)),
            signal: request.signal,
          }
        );
        return new Response(answer.body, {
          status: answer.status,
          headers: {
            "Content-Type":
              answer.headers.get("content-type") ?? "application/json",
          },
        });
      } catch (error) {
        return Response.json(
          {
            error: {
              message: `the provider did not answer: ${error instanceof Error ? error.message : String(error)}`,
            },
          },
          { status: 502 }
        );
      }
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
