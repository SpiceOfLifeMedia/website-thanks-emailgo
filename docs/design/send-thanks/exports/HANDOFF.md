# Send, thanks dashboard: handoff

Selected direction: **2b Workbench**. Source of truth for visuals: `SendThanksApp.dc.html` (live, responsive).

## Files
- `SendThanksDashboard.tsx`: page shell (sidebar, mobile top bar, usage strip, tab bar) and all 5 views. Presentational only.
- `send-thanks-dashboard.module.css`: tokens as custom properties, one breakpoint at 760px, reduced-motion block.
- `SendThanksLogo.tsx`: `<SendThanksLogo size surface withIcon />` and `<CommaIcon size surface favicon />`.
- `comma-icon.svg` (app icon, ink outline) and `favicon.svg` (no outline, heavier comma for 16/32px).

## Setup
- Fonts: load Schibsted Grotesk (400–800) and IBM Plex Mono (400, 500) via `next/font/google`. Mono is only for IDs, key prefixes and small labels.
- `app/layout.tsx`: `icons: { icon: '/favicon.svg' }`.
- Routes default to `/dashboard`, `/dashboard/emails`, `/dashboard/domains`, `/dashboard/block-list` and `/dashboard/api-keys`. Override them with the `hrefs` prop to match your existing routes. Each route renders `<SendThanksDashboard view="…" />`.

## Data and actions
- Pass the real data from your existing loaders. The prototype's records are **fictional**. Set `isDemo` only for demo accounts.
- The prototype contains **no new backend operations**. These callbacks map to handlers you already have, and an action is hidden if you leave its callback undefined:
  - `onAddDomain`
  - `onCreateApiKey`
  - `onRevokeApiKey(id)`
  - `onAddBlockedAddress`
  - `onRemoveBlockedAddress(address)`
- Filtering emails by status, searching the block list and showing/hiding DNS records all happen in the browser on data you already have.
- Field labels to keep: To, Subject, Status, Sent, and Last used.
- Email statuses are exactly those your app already records: **Queued**, **Sent**, **Deferred** and **Failed** (handoff), plus **Delivered**, **Bounced** and **Complained** (from signed delivery notifications). The Emails page filter chips only list statuses that are present.
- Domain statuses: Verified and Pending DNS.
- Block list reasons: Bounced, Complained and Added manually.

## Round 3 changes (port exactly)
- Brand: desktop sidebar and phone top bar both render `<SendThanksLogo withIcon iconSize={32} />`, which uses the same `CommaIcon` SVG. Don't use any other icon asset in those headers.
- Usage when `usage.limit === null`:
  - Desktop card: "Send requests this month", then "7 **so far**", with "No monthly cap is configured." once beside it. No meter.
  - Sidebar: "7 requests this month". No meter.
  - Phone strip: one line, "7 send requests this month". No meter.
  - With a cap, the meter versions render.
- Status badges: always 13px bold, 28px tall (`box-sizing: border-box`).
  - Failed: cream fill with a dashed ink border.
  - Bounced: tomato tint with a solid border.
  - Queued, Sent and Deferred: cream with a solid border, each with its own icon.
  - Delivered: basil. Complained: honey.
- Desktop email grid: `116px | 1.25fr | 1.35fr | 128px` (status · to · subject · sent).
  - Sent dates never wrap.
  - Status is 116px, not 104px: at 13px bold, the "Complained" badge with its icon needs about 114px, so 104px would clip it. The rest of the width goes to To.
- Clipped text: To, Subject and ID all carry `title` with the full value.
- IDs: `shortId()` keeps the first 10 characters, then "…", then the last 6.
- Phone email row: To + time / subject / badge + short ID on one line.
  - The card title and "LATEST 3" share a baseline (`align-items: baseline`, both line-height 1.2).
  - The account label is not shown in the phone top bar. Put the existing More button in `topbarAction`.
- Overview length: 6 emails on desktop, 3 on phone (`emails.slice(0, isPhone ? 3 : 6)`), or let the CSS hide rows 4–6 below 760px.
- Plural labels: "1 ADDRESS" / "3 ADDRESSES"; domains read "1/4 VERIFIED".

## Interaction rules
- **Overview:** shows the latest 6 emails (3 on mobile) and the latest 3 block list entries, with "See all" links to the full pages. Usage appears in the right-hand column of the Overview, and in the sidebar on every desktop page. On phones it is a pinned strip under the top bar instead.
- **Destructive actions** (Revoke, Remove) open an inline `role="alertdialog"` confirmation. The safe choice ("Keep it" / "Keep blocked") always sits next to the confirm button. The confirmation closes once your handler resolves.
- **Pending domains** open with their DNS records showing, and each record says "Found" or "Not found yet" in words.

## Accessibility
- **Status is never colour alone:** every status shows a word, an icon and a colour.
- **Contrast:** ink on tomato is 5.9:1 and chalk on basil is 6.2:1. Tomato is never used as a text colour.
- **Focus:** `:focus-visible` gives a 3px ink outline with a 6px honey halo. The current page is marked with `aria-current="page"` (honey fill and ink border).
- **Touch targets:** at least 44px on mobile (`--tap`). Tabs are 56px tall.
- **Usage meter:** `role="meter"` with `aria-valuenow` and `aria-valuemax`.
- **Reduced motion:** `prefers-reduced-motion` turns off the meter and hover transitions.

## Brand rules
- No service-provider names anywhere in the UI.
- No status dots, browser chrome, decorative charts or gradients.
- Never use Bricolage Grotesque.

## Final comma mark correction
- The icon is a round dot with a separate tapered tail below it. The two SVG shapes do not touch, leaving at least 5.8 units of tomato between them in the 64 unit viewBox (about 2.9px at 32px).
- The tail starts below and slightly right of the dot, then sweeps down-left. Use the final `SendThanksLogo.tsx`, `comma-icon.svg` and `favicon.svg` exports together; the icon favicon drops the outline and keeps the same comma geometry.
- Claude checked the 32px mark in the actual desktop sidebar and phone top bar screenshots. The updated local production build was also visually checked at 1440px and 390px.
