import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { cookies, headers } from "next/headers";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { readTheme, THEME_COLOR, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google from the phone.
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-figtree" });

export const metadata: Metadata = {
  title: "Halves",
  description: "Split receipts and keep a running tab.",
  applicationName: "Halves",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Halves", statusBarStyle: "default" },
  openGraph: { title: "Halves", description: "Split receipts and keep a running tab." },
};

// The status bar of an installed app follows this phone's Appearance: the chosen colour, or the
// phone's own light/dark setting under System.
export async function generateViewport(): Promise<Viewport> {
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
          ]
        : THEME_COLOR[theme],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en-AU" className={figtree.variable} data-theme={theme === "system" ? undefined : theme}>
      <head>
        {/* Chrome's install prompt can arrive before any app code runs: keep it for the Home card. */}
        {/* The browser hides a nonce attribute once the page loads, so hydration must not compare it. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: 'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__bip=e})' }}
        />
      </head>
      <body>
        <UpdatePrompt />
        {children}
      </body>
    </html>
  );
}
