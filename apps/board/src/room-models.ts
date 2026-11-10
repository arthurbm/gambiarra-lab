import { createOpenResponses } from "@ai-sdk/open-responses";

export interface RoomModelSummary {
  id: string;
  model: string;
  nickname: string;
}

interface ModelsResponse {
  data: Array<{
    id: string;
    owned_by: string;
    gambi?: { model?: string; nickname?: string };
  }>;
}

/**
 * Models of a Gambi room for the AI SDK v7, through the room's Open Responses
 * endpoint, the protocol Gambi defaults to. The hub falls back to chat
 * completions for participants that only speak that. Model IDs follow the
 * hub: a participant ID, `model:<name>`, or `*` for any available participant.
 */
export function createRoomModels(options: {
  hubUrl: string;
  roomCode: string;
}) {
  const baseURL = `${options.hubUrl}/rooms/${options.roomCode}/v1`;
  const provider = createOpenResponses({
    url: `${baseURL}/responses`,
    name: "gambi",
  });

  return {
    participant: (id: string) => provider(id),
    any: () => provider("*"),
    async listModels(): Promise<RoomModelSummary[]> {
      const response = await fetch(`${baseURL}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const body = (await response.json()) as ModelsResponse;
      return body.data.map((model) => ({
        id: model.id,
        nickname: model.gambi?.nickname ?? model.owned_by,
        model: model.gambi?.model ?? model.id,
      }));
    },
  };
}

export type RoomModels = ReturnType<typeof createRoomModels>;
