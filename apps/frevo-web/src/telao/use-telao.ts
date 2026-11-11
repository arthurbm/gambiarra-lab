import type { ModelPanelRow } from "@gambiarra-lab/frevo/models";
import type { PublicSnapshot } from "@gambiarra-lab/frevo/snapshot";
import { useEffect, useState } from "react";
import { connectTelaoStream, type StreamStatus } from "./stream";

/** The world as the telão gets it: the simulation plus the models panel. */
export type TelaoSnapshot = PublicSnapshot & { models?: ModelPanelRow[] };

/** The world as the server last published it, and how the connection is. */
export function useTelao(url = "/events/telao") {
  const [snapshot, setSnapshot] = useState<TelaoSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(
    () =>
      connectTelaoStream<TelaoSnapshot>({
        url,
        onSnapshot: setSnapshot,
        onStatus: setStatus,
      }),
    [url]
  );

  return { snapshot, status };
}
