// Turns a decision the simulation asked for into one chat/completions call
// with a single forced tool, and the model's tool call back into an action.
import type { Action, DecisionRequest } from "../sim/world";

export const DECISION_TOOL_NAME = "agir";

export interface ChatMessage {
  content: string | null;
  role: "assistant" | "system" | "tool" | "user";
}

export interface FunctionTool {
  function: {
    description: string;
    name: string;
    parameters: Record<string, unknown>;
  };
  type: "function";
}

export function decisionTool(request: DecisionRequest): FunctionTool {
  return {
    type: "function",
    function: {
      name: DECISION_TOOL_NAME,
      description:
        "Decide o que o boneco faz agora. Sempre chame esta ferramenta.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["acao", "lugar", "fala"],
        properties: {
          acao: {
            type: "string",
            enum: ["andar"],
            description: "andar: ir até um lugar da praça.",
          },
          lugar: {
            type: "string",
            enum: request.places.map((place) => place.id),
            description: "Para onde o boneco vai.",
          },
          fala: {
            type: "string",
            description:
              "O que o boneco diz em voz alta, em português, com até 80 caracteres.",
          },
        },
      },
    },
  };
}

export function decisionMessages(request: DecisionRequest): ChatMessage[] {
  const here = request.places.find((place) => place.id === request.placeId);
  const places = request.places
    .map((place) => `- ${place.id}: ${place.name}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        `Você é ${request.boneco.name}, um boneco de um bloco de frevo numa praça do Recife.`,
        "Você decide sozinho o que fazer e fala o que está pensando numa frase curta, em português do Brasil, com humor leve.",
        "A praça é um evento público: nada de palavrão, ofensa ou assunto pesado.",
        `Responda só chamando a ferramenta ${DECISION_TOOL_NAME}.`,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        here ? `Você está em: ${here.name}.` : "Você está no meio da praça.",
        "Lugares da praça:",
        places,
        "Escolha um lugar diferente de onde você está e diga por que vai.",
      ].join("\n"),
    },
  ];
}

interface ToolCallLike {
  function?: { arguments?: unknown; name?: unknown };
}

function firstToolCall(completion: unknown): ToolCallLike | undefined {
  const choices = (completion as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) {
    return;
  }
  const message = (
    choices[0] as { message?: { tool_calls?: unknown } } | undefined
  )?.message;
  const calls = message?.tool_calls;
  return Array.isArray(calls) ? (calls[0] as ToolCallLike) : undefined;
}

/** The action in a chat completion, or nothing when the model did not call the tool. */
export function parseDecision(completion: unknown): Action | undefined {
  const call = firstToolCall(completion);
  if (
    call?.function?.name !== DECISION_TOOL_NAME ||
    typeof call.function.arguments !== "string"
  ) {
    return;
  }
  let args: { fala?: unknown; lugar?: unknown } | null;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return;
  }
  if (typeof args?.lugar !== "string") {
    return;
  }
  return {
    type: "walk",
    placeId: args.lugar,
    speech: typeof args.fala === "string" ? args.fala : "",
  };
}
