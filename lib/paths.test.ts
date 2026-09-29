import { describe, expect, it } from "vitest";
import { safeNext, signInPath } from "./paths";

describe("safeNext", () => {
  it("accepts only a bill or a settled round, spelled exactly", () => {
    for (const ok of ["/bill/5", "/settled/3", "/bill/12?from=4"]) expect(safeNext(ok)).toBe(ok);
  });

  it("keeps the screen and drops what a messenger adds", () => {
    expect(safeNext("/bill/5?utm_source=x&from=2")).toBe("/bill/5?from=2");
    expect(safeNext("/bill/5#top")).toBe("/bill/5");
    expect(safeNext("/bill/5?from=x")).toBe("/bill/5");
    expect(safeNext("/settled/3?from=4")).toBe("/settled/3"); // only a bill uses from
  });

  it("refuses anything that could leave the app or reach another screen", () => {
    for (const bad of [
      "//evil.example/bill/5",
      "https://evil.example/bill/5",
      "javascript:alert(1)",
      "/bill/5/../../signout",
      "/bill/abc",
      "/\\evil.example/bill/5",
      "/settings",
      ["/bill/5", "/bill/6"],
      42,
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });

  it("builds the sign-in link, dropping anything unsafe", () => {
    expect(signInPath("/bill/5?from=2")).toBe("/signin?next=%2Fbill%2F5%3Ffrom%3D2");
    expect(signInPath("//evil.example")).toBe("/signin");
  });
});
