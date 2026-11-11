#!/usr/bin/env bun
// What is left to spend on OpenRouter: the account's real balance
// (GET /credits: purchased, used, remaining) and this key's own ceiling
// (GET /key: limit, usage, what is left under the limit). The two differ: a
// key with a US$ 50 limit on an account with US$ 3.55 left stops at US$ 3.55.
//
//   bun run frevo:spend
//
// The key comes through the model host's configuration (OPENROUTER_API_KEY or
// ~/.config/gambiarra-lab/openrouter.key) and is never printed. GET /credits
// needs a management key in OpenRouter's documentation; with
// OPENROUTER_MANAGEMENT_KEY (or ~/.config/gambiarra-lab/openrouter-management.key,
// moved by OPENROUTER_MANAGEMENT_KEY_FILE) it uses that one. Exits 1 when the
// balance could not be read, so nobody mistakes the key's limit for it.
import { homedir } from "node:os";
import { join } from "node:path";
import { providerKey } from "../apps/frevo/src/model-host/config";

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface Balance {
  purchased: number;
  remaining: number;
  used: number;
}

export interface KeyUsage {
  label: string;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  usage: number;
  usageDaily: number | null;
  usageMonthly: number | null;
}

export interface Spend {
  balance: Balance | { error: string };
  key: KeyUsage | { error: string };
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const TRAILING_SLASH = /\/+$/;

function hide(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[key]");
    }
  }
  return out;
}

async function getData(
  fetchFn: Fetch,
  url: string,
  key: string,
  secrets: string[]
): Promise<{ data: Record<string, unknown> } | { error: string }> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      error: hide(
        error instanceof Error ? error.message : String(error),
        secrets
      ),
    };
  }
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      // Not JSON; keep the start of the body.
    }
    return { error: `HTTP ${response.status}: ${hide(message, secrets)}` };
  }
  try {
    const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
    if (parsed.data && typeof parsed.data === "object") {
      return { data: parsed.data };
    }
  } catch {
    // Fall through.
  }
  return { error: "the answer has no `data` object" };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function readSpend(input: {
  baseUrl?: string;
  fetch?: Fetch;
  key: string;
  managementKey?: string;
}): Promise<Spend> {
  const base = (input.baseUrl || DEFAULT_BASE_URL).replace(TRAILING_SLASH, "");
  const fetchFn = input.fetch ?? fetch;
  const secrets = [input.key, input.managementKey ?? ""];
  const [credits, key] = await Promise.all([
    getData(
      fetchFn,
      `${base}/credits`,
      input.managementKey || input.key,
      secrets
    ),
    getData(fetchFn, `${base}/key`, input.key, secrets),
  ]);

  let balance: Spend["balance"];
  if ("error" in credits) {
    const forbidden =
      credits.error.startsWith("HTTP 401") ||
      credits.error.startsWith("HTTP 403");
    balance = {
      error:
        forbidden && !input.managementKey
          ? `${credits.error}. GET /credits needs a management key: set OPENROUTER_MANAGEMENT_KEY or put it in ~/.config/gambiarra-lab/openrouter-management.key`
          : credits.error,
    };
  } else {
    const purchased = num(credits.data.total_credits);
    const used = num(credits.data.total_usage);
    balance =
      purchased === null || used === null
        ? { error: "GET /credits has no total_credits or total_usage" }
        : { purchased, used, remaining: purchased - used };
  }

  let usage: Spend["key"];
  if ("error" in key) {
    usage = key;
  } else {
    const { data } = key;
    usage = {
      label: typeof data.label === "string" ? data.label : "",
      limit: num(data.limit),
      limitRemaining: num(data.limit_remaining),
      limitReset:
        typeof data.limit_reset === "string" ? data.limit_reset : null,
      usage: num(data.usage) ?? 0,
      usageDaily: num(data.usage_daily),
      usageMonthly: num(data.usage_monthly),
    };
  }
  return { balance, key: usage };
}

function usd(value: number | null): string {
  return value === null ? "none" : `US$ ${value.toFixed(2)}`;
}

export function formatSpend(spend: Spend): string {
  const lines: string[] = [];
  if ("error" in spend.balance) {
    lines.push(
      `Account balance (GET /credits): unknown, ${spend.balance.error}`
    );
  } else {
    lines.push(
      `Account balance (GET /credits): ${usd(spend.balance.remaining)} left (purchased ${usd(spend.balance.purchased)}, used ${usd(spend.balance.used)})`
    );
  }
  if ("error" in spend.key) {
    lines.push(`This key (GET /key): unknown, ${spend.key.error}`);
  } else {
    const { key } = spend;
    const reset = key.limitReset ? `, resets ${key.limitReset}` : "";
    lines.push(
      `This key (GET /key): used ${usd(key.usage)} (today ${usd(key.usageDaily)}, this month ${usd(key.usageMonthly)}); limit ${usd(key.limit)}${reset}, ${usd(key.limitRemaining)} under the limit`
    );
    lines.push(
      "The key's limit is a ceiling, not money: spending stops at whichever is lower, the account balance or what is left under the limit."
    );
  }
  return lines.join("\n");
}

async function managementKey(env: Env): Promise<string | undefined> {
  const fromEnv = env.OPENROUTER_MANAGEMENT_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const path =
    env.OPENROUTER_MANAGEMENT_KEY_FILE?.trim() ||
    join(homedir(), ".config", "gambiarra-lab", "openrouter-management.key");
  const fromFile = await Bun.file(path)
    .text()
    .then((text) => text.trim())
    .catch(() => "");
  return fromFile || undefined;
}

if (import.meta.main) {
  const { env } = process;
  const spend = await readSpend({
    baseUrl: env.OPENROUTER_BASE_URL?.trim(),
    key: await providerKey(env),
    managementKey: await managementKey(env),
  });
  console.log(formatSpend(spend));
  process.exit("error" in spend.balance ? 1 : 0);
}
