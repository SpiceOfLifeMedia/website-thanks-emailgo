# Email, thanks · Share email: handoff

Continuation of the **2b Workbench** dashboard. Visual source of truth: the Design canvas **“Email, thanks Share Email”** (11 artboards: desktop detail + dialog ×3, phone ×3, states board, public desktop ×2, public phone ×2). Everything below uses the existing tokens, Schibsted Grotesk + IBM Plex Mono, the 2px ink / radius 18 / 3px offset-shadow card language and the single 760px breakpoint. Nothing was added to the palette; no provider names anywhere.

## What the feature does

- On an email’s detail page, **Share email** opens a dialog (a bottom sheet on phones).
- The sender picks when the link expires: **10 minutes · 1 hour · 24 hours · 48 hours** (default **48 hours**), reads the warning *“Anyone with this link can view this email until it expires.”* and presses **Create link**.
- The dialog switches to **Link created**: read-only link field, **Copy link** (→ “Copied” for 2 s), the expiry timestamp, **Done**, and **Revoke link** (inline confirm, safe choice beside it).
- The detail page’s **Sharing** card mirrors the state (Not shared / Link active with Copy link and Manage or revoke link).
- The link opens a **public read-only page**: comma mark + wordmark, “Shared email” badge, From / To / Date, the subject, the message as text, a concise privacy notice. Expired, revoked and unknown tokens all show the same **“This link isn’t available”** page. BCC is never shown.

## Files

| File | What it is |
| --- | --- |
| `share-email.module.css` | All new styles. Extends `send-thanks-dashboard.module.css`; dashboard pieces inherit its custom properties, the public page (`.pub`) re-declares the same tokens because it has no shell. |
| `share-email-glyphs.tsx` | `GLYPH` paths, `<Glyph>`, `<MessageText>` (text-only body renderer), `formatDateTime`, `relativeToNow`. No `'use client'`, usable from server components. |
| `ShareEmailDialog.tsx` | The dialog / sheet. Native `<dialog>` + `showModal()`. Owns choose → busy → created → copied → confirm revoke → revoked, plus error states. |
| `EmailDetail.tsx` | The email detail view (page head, Message, Delivery, Details, Sharing cards) with the Share email action. Renders inside the existing shell. |
| `SharedEmailPage.tsx` | The public page, both states (`email` or `email: null`). |

Keep: `SendThanksDashboard.tsx` (exports `StatusBadge`, `EmailStatus`), `SendThanksLogo.tsx`, `send-thanks-dashboard.module.css`. Fonts already load via `next/font/google`; the artboards load the same families from Google Fonts only so they render on the canvas.

## Wiring

**1. Dashboard detail view.** The app keeps its current hash navigation. Email subjects open `#emails/{id}`; the admin detail API supplies the message text and delivery history, and the existing shell renders `EmailDetail` as its detail view.

```tsx
// SendThanksDashboard.tsx
export type View = 'overview' | 'emails' | 'domains' | 'block' | 'keys' | 'detail';
export interface DashboardProps { /* …existing… */ children?: ReactNode }
// nav: keep Emails highlighted while a detail is open
aria-current={n.id === view || (view === 'detail' && n.id === 'emails') ? 'page' : undefined}
// COPY: add  detail: ['', '']   (never shown: EmailDetail draws its own page head)
// in <main>: {view === 'detail' ? props.children : ( …the existing pageHead + grid… )}
```

```tsx
// src/app/page.tsx
<SendThanksDashboard view="detail" pageContent={
  <EmailDetail email={email} onCreateShareLink={createShareLink} onRevokeShareLink={revokeShareLink} />
} />
```

Overview and Emails rows link to the detail: wrap the subject (`eSubject strong`) in `<Link href={`${hrefs.emails}/${e.id}`}>` or make the row a link; nothing else on those pages changes.

**2. Public route** `src/app/share/page.tsx` (no shell, no sign-in). The token is carried after `#` in the URL, read by the browser, and cleared from the address bar before the browser posts it to `/api/share/view`:

```tsx
export default function SharedEmail() {
  return <SharedEmailLoader />;
}
```
The page loader accepts only the expected token shape, removes the fragment with `history.replaceState`, then posts the token in JSON to the same-origin view endpoint. The page and view response send `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and no-index headers.

**3. Handlers.** Two callbacks, both already shaped for `fetch`:

```ts
createShareLink(emailId, minutes)  → Promise<{ url: string; expiresAt: string }>
revokeShareLink(emailId)           → Promise<void>
```
Leave `onCreateShareLink` undefined and the Share email action and Sharing controls are not rendered (same rule as the other action props).

## Backend contract (this feature is new on the server)

Unlike the dashboard round, Share email needs three operations. Keep them small:

| Operation | Behaviour |
| --- | --- |
| `POST /api/emails/:id/share` body `{ "expires_in": "10m" \| "1h" \| "24h" \| "48h" }` | Creates a new link. Multiple links can remain active until they expire or are individually revoked. Returns `{ url, share_id, expires_at }`. |
| `DELETE /api/emails/:id/share/:share_id` | Revokes that link. Repeating the request is safe. |
| `GET /share/#shr_live_…` + `POST /api/share/view` body `{ "token": "…" }` | The browser reads the fragment, clears it from the address bar, then posts the token in a same-origin body. Missing, expired, and revoked tokens all render the same unavailable page. |

- Token: 256 bits from a CSPRNG, URL-safe base64, stored **hashed** (SHA-256); the raw URL is returned at creation and not stored.
- Expiry is enforced server-side (`expiresAt` is display only). Clock-skew margin of a few seconds is fine; never extend.
- Store `createdAt`, `createdBy`, `expiresAt`, `revokedAt` for the audit trail. A view counter is optional and is not shown in this UI.
- The public payload is a **projection**: subject, from (+ display name), to, sentAt, text/plain body, expiresAt. No BCC, no CC, no headers, no HTML part, no attachment bytes, no message ID. The page says when source attachment files were omitted.
- The token is in a URL fragment, so browsers do not send it in the page request or referrer. The page clears the fragment after reading it, posts it to the view endpoint, and that endpoint is not wrapped by request-body logging. Keep the endpoint out of analytics and error telemetry.

## Data shapes

```ts
EmailDetailData { id; subject; from; fromName?; to; sentAt (ISO); status: EmailStatus; text: string | null;
                  events: { status: EmailStatus; at (ISO); note: string }[]; share?: { url; expiresAt } | null }
SharedEmailData  { subject; from; fromName?; to; sentAt; text: string | null; expiresAt }
```
`from` is the sending address the app already knows (the verified domain); it isn’t on `EmailRow` today, so add it to the detail loader. `events` are the existing status transitions in words (Queued → Sent → Delivered, or Bounced / Complained / Deferred / Failed); the Delivery card renders each with `StatusBadge` + note + time. If an email has no text part, both pages say so instead of rendering HTML.

## Copy (verbatim)

| Where | Text |
| --- | --- |
| Page action | **Share email** |
| Dialog title | **Share this email** |
| Intro | Create a link to a read-only copy of “{subject}”. Anyone with the link can open it, no account needed. |
| Legend | Link expires in |
| Chips | 10 minutes · 1 hour · 24 hours · 48 hours |
| Expiry note | Expires **{Sun 29 Nov, 12:52 pm}** · in 48 hours |
| Warning (required line) | **Anyone with this link can view this email until it expires.** BCC recipients are never shown, and you can revoke the link at any time. |
| Buttons | Create link · Creating link… · Cancel |
| Created title | **Link created** + badge *Link active* |
| Field label | Shareable link |
| Copy | Copy link → Copied (aria-live: “Link copied to the clipboard”) |
| Expiry line | Expires **{Sun 29 Nov, 12:52 pm}** · in 48 hours |
| Warning (created) | **Anyone with this link can view this email until it expires.** Revoke it here if you shared it by mistake. |
| Buttons | Done · Revoke link |
| Revoke confirm | **Revoke this link?** Anyone who opens it will see that it’s no longer available. This can’t be undone. — Yes, revoke it · Keep link |
| Revoked title | **Link revoked** + badge *Link revoked* — This link no longer works. Anyone who opens it now sees that it isn’t available. You can create a new link whenever you like. — Done · Create a new link |
| Create error | **We couldn’t create the link.** Check your connection and try again. Your expiry choice is kept. |
| Revoke error | **We couldn’t revoke the link.** Try again. |
| Copy error | **Copy didn’t work.** Select the link and copy it yourself. |
| Sharing card, none | NOT SHARED — This email hasn’t been shared. **Share email** creates a read-only link that expires on its own, so someone can read it without a Email, thanks account. |
| Sharing card, active | LINK ACTIVE + badge *Link active* — expiry line, link, Copy link, Manage or revoke link |
| Public badge | Shared email |
| Public eyebrow | SHARED EMAIL · READ-ONLY COPY · Expires **{Sun 29 Nov, 12:52 pm}** |
| Public meta | From · To · Date (the subject is the h1) |
| Preview strip | Message · links shown as text · no images loaded (dashboard: Preview · …) |
| Public footnote | This read-only copy was shared from the sender’s Email, thanks account. It stops working on {Sun 29 Nov, 12:52 pm}. |
| Public notice | Only people with this link can see this page. It can’t be replied to or forwarded from here, and the person who shared it can turn it off at any time. |
| Unavailable | badge *Link unavailable* — **This link isn’t available** — It may have expired, or the person who shared it may have turned it off. If you still need the email, ask them to share it again. — SHARED LINKS LAST 48 HOURS AT MOST |
| Footer | Shared emails are read-only and expire on their own. |

Timestamps: `formatDateTime` gives `Sun 29 Nov, 12:52 pm` in the viewer’s zone (`Intl.DateTimeFormat('en-AU', …)`); the public page adds nothing else, so a viewer in another zone sees their own local time. The Delivery card shows seconds (`27 Nov, 12:43:19 pm`).

## Interaction rules

- **Open:** Share email → `showModal()`. Initial focus: the checked chip (48 hours) so ← → change the choice at once; when a link already exists the dialog opens in the created state with focus on Copy link.
- **Choose:** chips are real radios in a fieldset (one Tab stop, arrows move inside). The expiry note recomputes from `now + minutes` on every change.
- **Create:** button goes busy (`aria-busy`, tomato tint, label “Creating link…”, click ignored, still focusable). Success → created state, `onChange(link)` updates the Sharing card. Failure → error box under the warning, choice kept, button re-enabled.
- **Copy:** `navigator.clipboard.writeText`; “Copied” + basil fill for 2 s; polite live announcement. If the clipboard call throws (insecure context, permissions) the field is selected and the copy-error box shows.
- **Revoke:** Revoke link → inline `role="alertdialog"` confirm (tomato tint) replaces the footer button; **Keep link** sits next to **Yes, revoke it**. Success → revoked state, `onChange(null)`.
- **Close:** Done, Cancel, the X button and Esc all close; focus returns to Share email (native dialog behaviour). Clicking the scrim does not close (avoids accidental loss of a created link before copying).
- **Sharing card:** Copy link works from the page; Manage or revoke link reopens the dialog in the created state.
- Multiple active links can exist for one email; each link has its own expiry and revocation ID.
- **Public page:** no controls apart from the logo link. Links in the body are plain text; nothing external loads; no reply/forward.

## Accessibility

- **Status is never colour alone:** every badge is word + icon + colour (Link active basil, Link revoked line, Link unavailable dashed chalk, Shared email honey). Delivery state is the existing badges in a timeline with notes in words. No dots.
- **Focus:** `:focus-visible` = 3px ink outline, 2px offset, 6px honey halo (the dashboard rule, reused by `.pub` and the chips via `:focus-visible + label`).
- **Dialog:** `<dialog aria-labelledby>` + `showModal()` → focus trap, inert page, Esc, focus return. Close button is icon-only with `aria-label="Close"`. The confirm block is `role="alertdialog"`. Errors are `role="alert"`.
- **Labels:** fieldset legend “Link expires in”; `<label for>` on the link field; Copy announces through `aria-live="polite"`; the link field is `readonly` with the full URL in `title`.
- **Tab order, choose:** Close → chips → Create link → Cancel. **Created:** Close → link field → Copy link → Done → Revoke link (→ Yes, revoke it → Keep link).
- **Targets:** ≥44px on phone (`--tap`), 44px close button, 44px chips, 48px dialog buttons, 52px page primary; secondary buttons stay 36px on desktop as today.
- **Reduced motion:** nothing animates; the only transition (nav hover) is already off under `prefers-reduced-motion`.
- **Contrast (WCAG AA, computed from the tokens):** ink/chalk 16.6:1 · ink/paper 15.2:1 · ink/honey 12.2:1 · ink/honey tint 15.2:1 · ink/tomato tint 13.1:1 · ink/line 12.8:1 · chalk/basil 6.0:1 · ink/tomato 5.6:1 · pencil/chalk 5.6:1 · pencil/paper 5.1:1 · graphite/chalk 11.0:1. Tomato is never a text colour. The honey halo is decorative; the ink outline carries the focus indicator.

## Dimensions and tokens

| Element | Spec |
| --- | --- |
| Scrim | ink at 45% (`rgba(28,25,22,.45)`) via `dialog::backdrop` |
| Dialog | 540px wide, centred; chalk; 2px ink; radius 18; shadow `0 3px 0 ink`; head min 60px, padding 12/12/12/20, title 19px/800; body padding 20, gap 18; actions padding 16 20 20 with a 1px `line` rule |
| Sheet (phone) | full width, radius 18 on the top corners only, no bottom border, no shadow, `max-height: 92dvh`, body scrolls, actions stacked full width + safe-area padding |
| Chips | 44px, 2px ink, radius 999, 14px/700, padding 0 16 (0 10 on phone); selected ink/chalk; hover paper; 2×2 grid on phone |
| Warning box | honey tint, 2px ink, radius 12, padding 14, 14px/1.45, lead sentence 15px/700 ink; errors tomato tint |
| Link field | 44px, radius 12, 2px ink, white, IBM Plex Mono 13px, ellipsis; Copy link 44px radius 12; Copied = basil fill |
| Dialog buttons | 48px, radius 12, 16px (`.md`); page primary 52px/17px as today; confirm pair = inkBtn + plainBtn 44px |
| Detail head | back link 36px 14px/700 graphite; subject 36px/800 −0.035em (28px on phone), `text-wrap: balance`; meta row badge + 15px |
| Cards | Message preview: paper fill, 2px `line` border, radius 12, mono strip 12px, body 15px/1.6 at 64ch · Delivery grid 116px / 1fr / auto · Details labels 104px mono uppercase · Sharing padding 16 20 |
| Public bar | 64px chalk (56 on phone), 2px ink rule, 32px comma mark + 21px wordmark, Shared email badge |
| Public column | 760px; head padding 24 28; subject 32px/800 (26 on phone); meta labels 80px; body 16px/1.6 at 66ch; footnote mono 12px; notice 14px with lock glyph; footer 18/40 chalk |
| Unavailable | 560px card, 56px honey circle with clock glyph, 28px title, 16px copy, mono line |
| Fonts | Schibsted Grotesk 400–800 (`--sans`), IBM Plex Mono 400/500 (`--mono`, IDs, labels, link) |
| Colours | paper #F4EEE3 · chalk #FBF9F5 · ink #1C1916 · graphite #3D3832 · tomato #FF5A36 · honey #F7D56E · basil #2E6B4B · line #E3DCD0 · pencil #6B6359 · tomato tint #FFD6C9 · honey tint #FCEFC0 |

## Phone (≤759px)

- Email detail stacks: head (back, subject, badge row, full-width Share email), then Delivery, Details, Sharing, Message (`order` on the cards, same trick as the Overview). Nothing scrolls sideways: long addresses wrap (`overflow-wrap: anywhere`), the link field ellipsises, the preview box is fluid.
- The dialog becomes a bottom sheet over the pinned shell (top bar, usage strip, tab bar stay where they are). Chips 2×2 at 44px; Create link / Cancel / Done / Revoke link full width, stacked.
- Public page: 56px bar, single column, meta labels above values, 26px subject, footer stacked.

## Security notes for the public page

- Render only text. If the stored text part is absent, convert the HTML part to inert plain text. Never inject HTML or fetch message content from external origins.
- Links are shown as text (`<MessageText>`), so nothing can be clicked, prefetched or tracked. No images load.
- No BCC, CC, headers, attachments or message ID in the projection. Expired, revoked and unknown links return the same 404 page.
- Non-indexable (`robots` meta + `X-Robots-Tag`), `no-store`, and no-referrer.

## Implementation notes

- Share URLs use the existing canonical `EMAILGO_PUBLIC_URL` and `/share/#shr_live_…`. Browsers do not send the fragment in the page request; the loader clears it and posts it in the body to `/api/share/view`.
- Multiple links per email are allowed. The detail view keeps the newly created link in page state; the API returns `share_id` for revocation. The original hashed-only storage means a link URL cannot be recovered after leaving the page.
- The dashboard offers four expiry choices. The API also accepts valid human-readable durations up to 48 hours.
- The admin detail response maps delivery notifications into the designed word-status timeline.
- Public link views use 256-bit random tokens, hash-only storage, fragment-only URLs, `private, no-store`, no-referrer and no-index headers. The share token view endpoint is deliberately not wrapped in request-body logging. The unguessable token is the access control; there is no IP rate limiter.
