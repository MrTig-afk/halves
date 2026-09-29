import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { UpdatePrompt } from "@/components/UpdatePrompt";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1CC29F" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1F21" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={figtree.variable}>
      <body>
        <UpdatePrompt />
        {children}
      </body>
    </html>
  );
}
