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
- Email statuses must be exactly **Delivered**, **Bounced** and **Complained**.
- Domain statuses: Verified and Pending DNS.
- Block list reasons: Bounced, Complained and Added manually.

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
