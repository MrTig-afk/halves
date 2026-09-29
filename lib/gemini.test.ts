import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL, GeminiError, generateJson, PRIMARY_MODEL, untilPacificMidnight } from "./gemini";

type Reply = number | "timeout" | "badjson" | "bodytimeout" | { text: string };

// A fake fetch that answers each call from a script and records which model was asked.
function fakeFetch(script: Reply[]) {
  const models: string[] = [];
  const f = (async (url: string) => {
    models.push(String(url).match(/models\/([^:]+):/)![1]);
    const r = script.shift()!;
    if (r === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (typeof r === "number") return new Response("{}", { status: r });
    if (r === "badjson") return new Response("<html>oops</html>", { status: 200 });
    if (r === "bodytimeout") {
      const res = new Response("{}", { status: 200 });
      res.json = () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
      return res;
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: r.text }] } }] });
  }) as typeof fetch;
  return { f, models };
}
const deps = (f: typeof fetch) => ({ fetch: f, apiKey: "test-key", sleep: async () => {} });
const run = async (script: Reply[]) => {
  const { f, models } = fakeFetch(script);
  try {
    const out = await generateJson([{ text: "x" }], {}, deps(f));
    return { out: out.text, model: out.model, models };
  } catch (e) {
    return { error: (e as GeminiError).code, models };
  }
};

describe("generateJson", () => {
  it("returns the primary model's text on the first try", async () => {
    expect(await run([{ text: "{}" }])).toEqual({ out: "{}", model: PRIMARY_MODEL, models: [PRIMARY_MODEL] });
  });

  it("retries the primary once on 503, then succeeds", async () => {
    expect((await run([503, { text: "ok" }])).models).toEqual([PRIMARY_MODEL, PRIMARY_MODEL]);
  });

  it("falls back after two primary failures", async () => {
    const r = await run([503, "timeout", { text: "ok" }]);
    expect(r).toMatchObject({ out: "ok", model: FALLBACK_MODEL, models: [PRIMARY_MODEL, PRIMARY_MODEL, FALLBACK_MODEL] });
  });

  it("stops at once on 429: the free-tier cap is never retried or routed around", async () => {
    expect(await run([429, { text: "should not be reached" }])).toEqual({ error: "quota", models: [PRIMARY_MODEL] });
  });

  it("reports a timeout when every attempt times out", async () => {
    expect((await run(["timeout", "timeout", "timeout"])).error).toBe("timeout");
  });

  it("goes straight to the fallback on a 4xx: an invalid request is not asked twice", async () => {
    expect((await run([400, { text: "ok" }])).models).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
  });

  it("retries a 200 whose body is not JSON, and a timeout while reading the body", async () => {
    expect((await run(["badjson", { text: "ok" }])).models).toEqual([PRIMARY_MODEL, PRIMARY_MODEL]);
    expect((await run(["bodytimeout", "bodytimeout", "bodytimeout"])).error).toBe("timeout");
  });

  it("refuses to call without a key", async () => {
    const { f } = fakeFetch([{ text: "{}" }]);
    await expect(generateJson([{ text: "x" }], {}, { fetch: f, apiKey: "" })).rejects.toThrow("GEMINI_API_KEY");
  });
});

describe("quota", () => {
  it("stops on 429 without retrying and reports Google's retry delay", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return Response.json(
        { error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36.5s" }] } },
        { status: 429 },
      );
    }) as typeof fetch;
    const e = await generateJson([{ text: "x" }], {}, deps(f)).catch((x) => x);
    expect(e).toMatchObject({ code: "quota", retryAfterS: 37 });
    expect(calls).toBe(1);
  });

  it("waits until Pacific midnight when the per-day quota is the one used up", async () => {
    const f = (async () =>
      Response.json(
        {
          error: {
            details: [
              { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
              { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "20s" },
            ],
          },
        },
        { status: 429 },
      )) as typeof fetch;
    const models: string[] = [];
    const counted = (async (url: string) => {
      models.push(String(url).match(/models\/([^:]+):/)![1]);
      return f(url);
    }) as typeof fetch;
    const e = await generateJson([{ text: "x" }], {}, deps(counted)).catch((x) => x);
    expect(e).toMatchObject({ code: "quota", daily: true });
    expect(e.retryAfterS).toBeGreaterThan(20);
    expect(e.retryAfterS).toBeLessThanOrEqual(86_400);
    // the per-day allowance is per model: the fallback gets one try, then it stops
    expect(models).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
  });

  it("counts the seconds to midnight on the Pacific clock", () => {
    // 2026-09-29 23:00 PDT (UTC-7) is 06:00 UTC on the 30th: one hour to go.
    expect(untilPacificMidnight(new Date("2026-09-30T06:00:00Z"))).toBe(3600);
    expect(untilPacificMidnight(new Date("2026-09-30T07:00:00Z"))).toBe(86_400);
  });

  it("leaves the delay unknown when the 429 body has none", async () => {
    const e = await generateJson([{ text: "x" }], {}, deps((async () => new Response("<html>", { status: 429 })) as typeof fetch)).catch((x) => x);
    expect(e).toMatchObject({ code: "quota", retryAfterS: undefined });
  });
});
