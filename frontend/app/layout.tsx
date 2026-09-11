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
  title: "Pyron Finance — Fixed income for Flare's FAssets",
  description:
    "Pyron splits yield-bearing FAsset positions into a fixed-value Principal Token and a leveraged Yield Token — Flare's first real fixed-income market.",
  openGraph: {
    title: "Pyron Finance — Fixed income for Flare's FAssets",
    description:
      "Lock in a fixed rate on FXRP, or trade the yield itself. Flare's first fixed-income market.",
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
