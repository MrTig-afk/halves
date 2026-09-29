import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("service worker route", () => {
  it("serves a script that compiles", async () => {
    const script = await GET().text();
    // new Function compiles without running: any syntax error in the template throws here.
    expect(() => new Function(script)).not.toThrow();
  });

  it("puts the version in the worker's bytes so each deploy is a new worker", async () => {
    expect(await GET().text()).toMatch(/const CACHE = "halves-shell-[\w-]+";/);
  });
});
