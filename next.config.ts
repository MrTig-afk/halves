import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Each Vercel deploy gets a new version, which changes the service worker's
    // bytes and so triggers the "new version" prompt (app/sw.js/route.ts).
    NEXT_PUBLIC_APP_VERSION: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev").slice(0, 12),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera and microphone are needed for scanning and voice; nothing else.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          // No framing on any path, including the ones the proxy's policy skips (build files, a 404).
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
