import type {Metadata} from "next";
import type {ReactNode} from "react";

import "@/styles/tokens.css";
import "./landing.css";

/**
 * Root layout for the landing page.
 *
 * The landing is built on `html { font-size: 1vw }` so the whole composition
 * scales as a single piece — right for a poster, wrong for a trading screen.
 * That is why it used to live in its own route group with its own <html>,
 * separate from the app's root layout; the app is gone and the landing is now
 * the only route, so the group is gone with it.
 */
export const metadata: Metadata = {
  title: "Pyron Finance — Private OTC trading on Midnight",
  description:
    "Pyron is a private OTC venue on Midnight: bonded dealers commit sealed quotes on-chain before revealing a price, anyone can slash a dealer whose reveal doesn't match, and trades settle atomically through Zswap.",
  openGraph: {
    title: "Pyron Finance — Private OTC trading on Midnight",
    description:
      "Sealed bids from bonded dealers, settled privately on Midnight. No last look, no allowlist, no identity required.",
    type: "website",
  },
  icons: {icon: {url: "/assets/logo-badge.svg", type: "image/svg+xml"}},
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
