import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config headers", () => {
  it("sends the fixed security headers, and no CSP (the proxy owns it)", async () => {
    const all = await nextConfig.headers!();
    const entry = all.find((h) => h.source === "/(.*)")!;
    expect(entry.headers).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
      { key: "X-Frame-Options", value: "DENY" },
    ]);
  });
});
