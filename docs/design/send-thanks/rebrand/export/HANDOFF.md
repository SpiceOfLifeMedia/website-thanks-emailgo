# Send, thanks: brand + dashboard handoff

The Claude Design source and export files are preserved under `docs/design/send-thanks/rebrand/`. The app integration copies the logo, dashboard component and styles into `src/components`, then connects them to live dashboard data in `src/app/page.tsx`.

## Exports
- **`docs/design/send-thanks/rebrand/SendThanksBrandDashboard.dc.html`:** the review board.
  - R1: the wordmark on chalk and on ink, the comma icon at 96, 48 and 32px plus the favicon at 16px on both backgrounds, and the palette.
  - R2: the desktop Overview at 1440 × 1000.
  - R3: the phone Overview at 390 × 844, shown twice: unfiltered, and filtered to Bounced.
- **`docs/design/send-thanks/rebrand/SendThanksDashboardScreen.dc.html`:** the live screen used by the board. Props: `mode` (`desktop`/`mobile`) and `filter`. Its records are illustrative and exist only in this file. The filter chips and Unblock work; other buttons show a note explaining what they'd open.
- **`docs/design/send-thanks/rebrand/export/SendThanksLogo.tsx`:**
  - `SendThanksLogo`: `size`, `withIcon`, `iconSize`, and `tone` (`ink` | `chalk`).
  - `CommaIcon`: `size`, `outlined`, `title`.
  - The colour constants.
- **`docs/design/send-thanks/rebrand/export/comma-icon.svg`:** the outlined app icon. **`docs/design/send-thanks/rebrand/export/favicon.svg`:** the flat tile, no outline.
- **`docs/design/send-thanks/rebrand/export/SendThanksDashboard.tsx`:** the shell and Overview as one presentational `'use client'` component. It contains no records.
- **`docs/design/send-thanks/rebrand/export/send-thanks-dashboard.module.css`:** all of its styles.

## Brand
- Based on the selected companion logo option 1a, "Tomato comma".
- **Wordmark:** Schibsted Grotesk 800, letter-spacing −0.035em, "Send" + a tomato "," + " thanks".
- **Icon:** a chalk dot (`cx 32 cy 23 r 9`) and a separate tapered tail (`M41 35.5C41 43 34 49 21 52C27 48 31 43.5 32.5 38.5Z`) on a tomato tile with radius 16 and a 3px ink outline. The favicon is the same shape on a flat tile with radius 14.
- **Colours:**

  | Name | Hex |
  | --- | --- |
  | paper | `#F4EEE3` |
  | chalk | `#FBF9F5` |
  | ink | `#1C1916` |
  | graphite | `#3D3832` |
  | line | `#E3DCD0` |
  | tomato | `#FF5A36` |
  | honey | `#F7D56E` |
  | basil | `#2E6B4B` |
  | pale tomato | `#FFD6C9` |

- **Type:** Schibsted Grotesk throughout. IBM Plex Mono only for domains, keys, counts and small labels.

## Integration boundary
The component renders what it's given and reports clicks; it fetches nothing. Copy `SendThanksLogo.tsx` alongside it, because the dashboard imports it.

**Props (all serializable apart from the callbacks):**
```ts
accountName: string
activeNav?: 'overview'|'emails'|'domains'|'keys'|'block'
usage: { used: number; limit: number | null; resetsOn?: ISO | null }   // limit null → "emails so far" + "No monthly cap is configured."
recentEmails: { id, to, subject, status: 'queued'|'sent'|'delivered'|'bounced'|'complained'|'failed', sentAt: ISO }[]
emailCounts?: Partial<Record<'all'|'delivered'|'bounced'|'complained', number>>
emailFilter: 'all'|'delivered'|'bounced'|'complained'
domains: { id, name, status: 'verified'|'pending'|'failed' }[]
apiKeys: { id, name, maskedKey, lastUsedAt: ISO | null }[]   // pass keys already masked; never the secret
blockList: { id, address, reason: 'bounced'|'complained'|'manual', blockedAt: ISO }[]
blockListTotal?: number
errors?: Partial<Record<'emails'|'domains'|'keys'|'block'|'usage', string>>
notice?: string | null
layout?: 'desktop'|'mobile'; timeZone? = 'Australia/Sydney'; locale? = 'en-AU'; now?: ISO
```

**Callbacks:**
- `onNavigate(id)`
- `onEmailFilterChange(filter)`
- `onOpenEmail(id)`
- `onViewAllEmails()`
- `onAddDomain()`
- `onOpenDomain(id)`
- `onCreateApiKey()`
- `onViewBlockList()`
- `onUnblock(id)`: confirm it or offer undo in the page, then refresh `blockList`.
- `onDismissNotice?()`

Only pass statuses your backend actually records. If the API reports only queued, sent or failed, the Delivered, Bounced and Complained chips simply show 0.

## States: words plus shapes
Every badge has a word, an icon and a 2px ink border, so colour is never the only signal:
- **Emails:**
  - Delivered: basil, tick
  - Bounced: tomato, return arrow
  - Complained: ink, flag
  - Sent: chalk, paper plane
  - Queued: paper, dashed border, clock
  - Failed: pale tomato, dashed border, cross
- **Domains:**
  - Verified: basil, tick
  - Pending: honey, clock
  - Failed: pale tomato, dashed border, cross
- **Block reasons:**
  - Bounced: tomato, return arrow
  - Complained: ink, flag
  - Added by you: chalk, blocked circle

There are no status dots and no gradients.

## Layout
**Desktop**
- A 248px sidebar with the logo, account and nav (44px items, honey when current).
- Content max-width is 1160px, with 32px padding.
- Row 1 is a grid of `minmax(0,1fr) 360px`: Recent emails (table columns `1.1fr 1.4fr 136px 92px`) on the left; Usage and Sending domains stacked on the right.
- Row 2 is two equal columns: API keys and Block list.
- Cards have a 2px ink border, 18px radius and a `0 3px 0` shadow.

**Phone (390)**
- A 56px top bar with the logo, and a 5-tab bottom nav (56px tall) with safe-area padding.
- One column, in this order: Usage, Sending domains, Recent emails, API keys, Block list.
- Filters are a 2 × 2 grid of 52px buttons. Emails show as stacked cards: address and time, then the subject (wrapping), then the badge.
- Every control is 52px. Text either wraps anywhere or is clipped with an ellipsis, and the scroller hides horizontal overflow, so nothing scrolls sideways.

## Accessibility
- **Focus:** a 3px ink outline plus a 6px honey ring.
- **Landmarks:** the nav is labelled "Dashboard" and uses `aria-current="page"`. Each section is labelled by its heading.
- **Filters:** a `role=group` using `aria-pressed`.
- **Email rows:** buttons with a spoken summary, e.g. "Bounced. To …. Subject. 9:12 am".
- **Usage meter:** `role="meter"` with `aria-valuetext`.
- **Unblock:** each button is labelled "Unblock {address}".
- **Errors:** use `role=alert`; the notice uses `role=status`.
- **Reduced motion:** turns off all transitions.
