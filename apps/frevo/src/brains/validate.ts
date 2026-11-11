// Checks a model's tool call against the tool's JSON schema. A cut answer
// often still parses (`{"acao":"fal"}`), so "it is JSON" is not enough. Lines
// with letters outside the Latin alphabet are refused too: they would reach
// the telão, and one model leaked Chinese into its Portuguese.
import type { FunctionTool } from "./decision";

interface Schema {
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: Schema;
  maxItems?: number;
  maxLength?: number;
  minItems?: number;
  minLength?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  type?: string;
}

export type ToolArguments =
  | { args: Record<string, unknown>; ok: true }
  | { ok: false; reason: string };

// A letter of any script but Latin, or CJK punctuation and full-width forms.
const FOREIGN_TEXT = /(?!\p{Script=Latin})\p{L}|[　-〿＀-￯]/u;

function check(value: unknown, schema: Schema, path: string): string | null {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} is not one of ${JSON.stringify(schema.enum)}`;
  }
  switch (schema.type) {
    case "object":
      return checkObject(value, schema, path);
    case "array":
      return checkArray(value, schema, path);
    case "string":
      return checkString(value, schema, path);
    case "integer":
      return Number.isInteger(value) ? null : `${path} is not an integer`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${path} is not a number`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} is not a boolean`;
    default:
      return null;
  }
}

function checkString(value: unknown, schema: Schema, path: string) {
  if (typeof value !== "string") {
    return `${path} is not a string`;
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return `${path} is longer than ${schema.maxLength}`;
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return `${path} is shorter than ${schema.minLength}`;
  }
  return FOREIGN_TEXT.test(value)
    ? `${path} has letters outside the Latin alphabet`
    : null;
}

function checkArray(value: unknown, schema: Schema, path: string) {
  if (!Array.isArray(value)) {
    return `${path} is not an array`;
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return `${path} has fewer than ${schema.minItems} items`;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return `${path} has more than ${schema.maxItems} items`;
  }
  for (const [index, item] of value.entries()) {
    const problem = schema.items
      ? check(item, schema.items, `${path}[${index}]`)
      : null;
    if (problem) {
      return problem;
    }
  }
  return null;
}

function checkObject(value: unknown, schema: Schema, path: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${path} is not an object`;
  }
  const record = value as Record<string, unknown>;
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) {
      return `${path}.${key} is missing`;
    }
  }
  for (const [key, item] of Object.entries(record)) {
    const property = properties[key];
    if (!property) {
      if (schema.additionalProperties === false) {
        return `${path}.${key} is not allowed`;
      }
      continue;
    }
    const problem = check(item, property, `${path}.${key}`);
    if (problem) {
      return problem;
    }
  }
  return null;
}

/** The arguments of the first tool call, when it is `tool` and they satisfy its schema. */
export function toolArguments(
  completion: unknown,
  tool: FunctionTool
): ToolArguments {
  const choices = (completion as { choices?: unknown } | null)?.choices;
  const message = Array.isArray(choices)
    ? (choices[0] as { message?: { tool_calls?: unknown } } | undefined)
        ?.message
    : undefined;
  const calls = message?.tool_calls;
  const call = Array.isArray(calls)
    ? (calls[0] as { function?: { arguments?: unknown; name?: unknown } })
    : undefined;
  if (!call?.function) {
    return { ok: false, reason: "the model answered without a tool call" };
  }
  if (call.function.name !== tool.function.name) {
    return {
      ok: false,
      reason: `the model called ${String(call.function.name)}`,
    };
  }
  let args: unknown;
  try {
    args =
      typeof call.function.arguments === "string"
        ? JSON.parse(call.function.arguments)
        : call.function.arguments;
  } catch {
    return { ok: false, reason: "the tool arguments are not JSON" };
  }
  const problem = check(args, tool.function.parameters as Schema, "args");
  if (problem) {
    return { ok: false, reason: problem };
  }
  return { ok: true, args: args as Record<string, unknown> };
}
