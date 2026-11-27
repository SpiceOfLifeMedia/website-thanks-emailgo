# Send, thanks: thread composer handoff

This package extends the selected-conversation composer from `SharedInboxWorkspace` (shared inbox). It adds Reply, Reply all and Forward, persistent drafts, Cc and Bcc fields, and a discard confirmation. It's a front-end component only: nothing is sent and nothing is stored.

## Files
- `inbox-composer/SendThanksInboxComposer.dc.html`: the live prototype, with eight frames. All messages and addresses are fictional.
  - Desktop 1440 × 1000: c1a Reply with draft saved, c1b Reply all, c1c Forward, c1d Discard confirmation.
  - Phone 390 × 844: c2a–c2d, the same four states.
- `inbox-composer/export/SendThanksInboxComposer.tsx`: the controlled `'use client'` component, plus pure helpers.
- `inbox-composer/export/send-thanks-inbox-composer.module.css`: all of its styles, using the same tokens as `shared-inbox-workspace.module.css`.

## Integration with SharedInboxWorkspace
- Render `<SendThanksInboxComposer>` where the workspace currently renders its reply form, below the message timeline.
- `Mailbox` matches the host's type. Build `source` from the latest `ThreadMessage`: `{ from, to, cc, sentAtLabel, text }`.
- The host's `onReply({ threadId, inboxId, text })` only covers a plain reply. Give the host a fuller send callback that takes `ComposerValue` plus `threadId`, and keep `onReply` as the adapter for mode `reply`.

## Props
```ts
value: { mode: 'reply'|'replyAll'|'forward', from, to, cc, bcc, subject, body }  // recipient fields are comma-separated strings
fromOptions: Mailbox[]                // inbox addresses the user may send from
source: { from, to, cc?, sentAtLabel, text }
threadSubject: string
open: boolean
draftStatus: 'new' | 'dirty' | 'saving' | 'saved' | 'error'
savedAtLabel?: string                 // "9:52 am"
errors?: { to?, cc?, bcc?, subject?, body?, form? }
sending?: boolean
layout?: 'desktop' | 'mobile'
onChange(patch) · onModeChange(mode) · onOpen(mode?) · onClose() · onSaveDraft() · onDiscardDraft() · onSend()
```

**Helpers:**
- `recipientsFor(mode, source, inboxAddress)`, `subjectFor(mode, subject)` and `validateComposer(value)`.
- Address utilities: `splitRecipients`, `addressOf` and `formatMailbox`.

**Who owns what:** the host owns `value`, `open` and `draftStatus`. The component only keeps UI state: whether Cc and Bcc are showing, and whether the discard confirmation is open.

## Modes and recipients
- **Reply:** To is the sender of the source message.
- **Reply all:** To is the sender plus the other To recipients; Cc is the original Cc.
- **Always, for both reply modes:**
  - The current inbox address is removed.
  - Duplicates are dropped.
  - Bcc is never prefilled, and the original sender is never added to Bcc.
- **Forward:** To starts empty and is editable. The subject is prefixed with `Fwd:`, and a read-only preview of the forwarded message (From, Date, Subject, To, text) sits under the body.
- **Subjects:** `subjectFor` strips existing `Re:` and `Fwd:` prefixes before adding one.
- **Switching modes:** in `onModeChange`, recompute To, Cc and Subject with the helpers and keep the body.

## Drafts
- The draft status is always shown as words, never a dot:

  | Status | Text |
  | --- | --- |
  | `new` | Not saved yet |
  | `dirty` | Unsaved changes |
  | `saving` | Saving draft… |
  | `saved` | Draft saved {time} |
  | `error` | Draft not saved. Try again. |

- **Save draft:** disabled while the status is `saved` or `saving`. Autosaving after about 2 seconds of no typing is recommended; the component works either way.
- **Close:** keeps the draft. The host should save if it's `dirty`. With `open=false` and a draft present, a dashed "{Mode} draft · Draft saved … · To …" bar appears with **Reopen draft**. With no draft, the Reply / Reply all / Forward buttons appear instead.
- **Discard draft:** opens an inline confirmation, "Discard this draft? Its recipients, subject and message will be deleted. This can’t be undone." **Keep draft** gets focus. `onDiscardDraft` fires only after the user confirms.

## Validation
`validateComposer(value)` checks:
- To has at least one recipient.
- Every To, Cc and Bcc entry is a valid address, either `Name <a@b.example>` or `a@b.example`.
- The subject isn't empty.
- The body isn't empty, except in Forward mode.

Pass the result as `errors` after a send attempt. Each error shows under its field; that field gets a dashed border and `aria-invalid`, and a summary line names how many things need fixing. Validate on the server too.

## Responsive behaviour
- **Desktop (44px controls):** labels sit in a 72px column to the left of their fields. Actions are Send, Save draft, Close, then Discard draft pushed to the right.
- **Phone (`layout="mobile"`, 52px controls, 16px text so iOS doesn't zoom):**
  - Labels sit above their fields.
  - Send is full width; Save draft and Close share a row; Discard draft is full width.
  - Bottom padding includes `env(safe-area-inset-bottom)`.
  - Text wraps anywhere, so nothing scrolls sideways at 390px.

## Accessibility
- **Labels:** every field has a visible label.
- **Mode switch:** a `radiogroup` using `aria-checked`.
- **Draft status:** announced with `aria-live="polite"`.
- **Errors:** use `role="alert"`; the discard confirmation is `role="alertdialog"`.
- **Focus:** a 3px ink outline plus a 6px honey ring.
- **Reduced motion:** turns off transitions.
- **Avoided:** status dots, gradients, decorative icons and provider names.

## Checked and not checked
- **Checked:** the TSX parses with no syntax errors through the TypeScript 5.4 transpiler, run inside the design environment.
- **Also checked:** `recipientsFor`, `subjectFor` and `validateComposer` were run on sample data.
  - Reply all drops the inbox address, even when its case differs, and keeps Bcc empty.
  - `Re: Re:` and `Fwd:` prefixes are normalised.
  - Malformed To and Bcc entries are reported.
- **Not checked:** a full type-check against your project's React types and `tsconfig`, and the component rendering inside the real Next.js app. Please run `tsc --noEmit` and your tests after copying it in.
