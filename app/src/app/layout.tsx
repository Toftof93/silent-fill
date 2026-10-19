import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { Providers } from "./providers";
import { DarkWater } from "@/components/DarkWater";
import "./globals.css";

const DESCRIPTION = "Filled. Not seen. A sealed-bid dark pool on Robinhood Chain: no front-running, no sandwiches, one fair price.";

export const metadata: Metadata = {
  metadataBase: new URL("https://silentfill.xyz"),
  title: "Silent Fill",
  description: DESCRIPTION,
  openGraph: {
    title: "Silent Fill · Filled. Not seen.",
    description: DESCRIPTION,
    url: "https://silentfill.xyz",
    siteName: "Silent Fill",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Silent Fill · Filled. Not seen.",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="backdrop" aria-hidden>
          <div className="blobs"><i /><i /><i /></div>
          <DarkWater />
          <div className="glow-a" />
          <div className="grain" />
          <div className="vignette" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
