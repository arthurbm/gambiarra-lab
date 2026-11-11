// The headers of every SSE stream the world server opens: no cache, no
// transform and no proxy buffering, so each event reaches the browser now.
export function sseHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
