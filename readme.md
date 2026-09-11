# Pyron Finance — Landing Page

The marketing landing page for **Pyron Finance**, a fixed-income and yield-trading
protocol for Flare's FAssets ecosystem.

This repository contains the landing page only. The protocol contracts, indexer,
keeper, and trading app that used to live alongside it have been removed; the
full protocol design is still written up in [`PROTOCOL_SPEC.md`](./PROTOCOL_SPEC.md).

## Stack

Next.js 15 (App Router) + React 19, server-rendered, no client data layer. The
page ships three client components — `LandingEffects` (scroll and Lottie
behaviour), `LaunchApp` (hero CTA), and `WaitlistForm` — and nothing else.

## Layout

```
frontend/
  app/
    layout.tsx      root layout: fonts, metadata, html { font-size: 1vw }
    page.tsx        the whole landing page, server-rendered
    landing.css     page styles
  components/marketing/
  styles/tokens.css shared design tokens (colour, type, shape)
  public/assets/    imagery, Lottie animations, lottie.min.js
```

The page is built on `html { font-size: 1vw }` so the entire composition scales
as one piece rather than reflowing section by section.

## Running it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build
pnpm start
```

`pnpm typecheck` runs `tsc --noEmit`.

## Waitlist

`WaitlistForm` currently collects the email client-side only — wire it to your
provider before launch. The hero CTA links to `#waitlist` in the footer.
