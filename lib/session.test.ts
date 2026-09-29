import { beforeAll, describe, expect, it } from "vitest";
import { readSessionId, signSession } from "./session";

const id = "3f1c2b8e-5d7a-4e9b-8c1f-0a2b3c4d5e6f";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-000000";
});

describe("session cookie", () => {
  it("reads back the session id it signed", () => {
    expect(readSessionId(signSession(id))).toBe(id);
  });

  it("refuses an edited id, an edited signature, and an unsigned value", () => {
    const good = signSession(id);
    const otherId = "3f1c2b8e-5d7a-4e9b-8c1f-0a2b3c4d5e70";
    expect(readSessionId(good.replace(id, otherId))).toBeNull();
    expect(readSessionId(good.slice(0, -2) + "xx")).toBeNull();
    expect(readSessionId(id)).toBeNull();
    expect(readSessionId(undefined)).toBeNull();
  });

  it("refuses a cookie signed with another secret", () => {
    const good = signSession(id);
    process.env.SESSION_SECRET = "a-different-secret-also-long-enough-111";
    expect(readSessionId(good)).toBeNull();
  });
});
