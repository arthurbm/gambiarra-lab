import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { formatSpend, readSpend } from "./frevo-spend";

const KEY = "sk-or-v1-fake-inference-key-0123456789";
const MANAGEMENT = "sk-or-v1-fake-management-key-9876543210";

// A fake OpenRouter: /credits only for the management key, /key for the
// inference key, with the numbers of the day the two were confused.
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    if (url.pathname === "/api/v1/credits") {
      if (auth !== `Bearer ${MANAGEMENT}`) {
        return Response.json(
          {
            error: {
              code: 403,
              message: `Only management keys can perform this operation (${auth})`,
            },
          },
          { status: 403 }
        );
      }
      return Response.json({ data: { total_credits: 5, total_usage: 1.45 } });
    }
    if (url.pathname === "/api/v1/key" && auth === `Bearer ${KEY}`) {
      return Response.json({
        data: {
          label: "sk-or-v1-fak...789",
          limit: 50,
          limit_remaining: 49.03,
          limit_reset: null,
          usage: 0.97,
          usage_daily: 0.12,
          usage_monthly: 0.97,
        },
      });
    }
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  },
});
const baseUrl = `http://127.0.0.1:${server.port}/api/v1`;

afterAll(() => server.stop(true));

describe("frevo:spend", () => {
  test("reports the account balance apart from the key's limit", async () => {
    const spend = await readSpend({
      baseUrl,
      key: KEY,
      managementKey: MANAGEMENT,
    });
    expect(spend.balance).toEqual({
      purchased: 5,
      used: 1.45,
      remaining: 3.55,
    });
    expect(spend.key).toMatchObject({ limit: 50, limitRemaining: 49.03 });
    const text = formatSpend(spend);
    expect(text).toContain("Account balance (GET /credits): US$ 3.55 left");
    expect(text).toContain("limit US$ 50.00");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(MANAGEMENT);
  });

  test("without a management key the balance is unknown, never the limit, and the key stays hidden", async () => {
    const spend = await readSpend({ baseUrl, key: KEY });
    expect("error" in spend.balance).toBe(true);
    const text = formatSpend(spend);
    expect(text).toContain("Account balance (GET /credits): unknown, HTTP 403");
    expect(text).toContain("needs a management key");
    expect(text).not.toContain("49.03 left");
    expect(text).not.toContain(KEY);
  });

  test("the script exits 1 without the balance and prints no key", async () => {
    const child = Bun.spawn(["bun", join(import.meta.dir, "frevo-spend.ts")], {
      env: {
        ...process.env,
        OPENROUTER_API_KEY: KEY,
        OPENROUTER_MANAGEMENT_KEY: "",
        OPENROUTER_MANAGEMENT_KEY_FILE: "/nonexistent/management.key",
        OPENROUTER_BASE_URL: baseUrl,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(1);
    expect(out).toContain("This key (GET /key): used US$ 0.97");
    expect(out + err).not.toContain(KEY);
  });
});
