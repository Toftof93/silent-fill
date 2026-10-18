import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
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
    card: "summary",
    title: "Silent Fill · Filled. Not seen.",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
