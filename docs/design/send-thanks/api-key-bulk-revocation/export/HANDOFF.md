# API key bulk revocation — handoff

Extends the dashboard **API keys** view (`SendThanksDashboard.tsx`, `view === 'keys'`). The exported code is the source of truth; the prototype (`../SendThanksApiKeyBulkRevocation.dc.html`) revokes nothing.

## Files
- `SendThanksApiKeyBulkRevocation.tsx` — controlled component, default export.
- `send-thanks-api-key-bulk-revocation.module.css` — 42 classes, all used by the TSX.
- `../screenshots/desktop-confirm-1440x1000.png`, `../screenshots/phone-confirm-390x844.png`.

## Usage
```tsx
const [selectedIds, setSelectedIds] = useState<string[]>([]);
const [step, setStep] = useState<BulkRevokeStep>('select');
const [phrase, setPhrase] = useState('');
const [pendingSingleId, setPendingSingleId] = useState<string | null>(null);

<SendThanksApiKeyBulkRevocation
  keys={apiKeys}
  selectedIds={selectedIds} onSelectedIdsChange={setSelectedIds}
  step={step} onStepChange={setStep}
  confirmPhrase={phrase} onConfirmPhraseChange={setPhrase}
  pendingSingleId={pendingSingleId} onPendingSingleIdChange={setPendingSingleId}
  onRevokeKey={async id => { await revokeKey(id); setPendingSingleId(null); }}
  onRevokeKeys={async ids => { await revokeKeys(ids); setSelectedIds([]); setPhrase(''); setStep('select'); }}
  busy={busy} notice={notice}
/>
```
Wire `onRevokeKey` / `onRevokeKeys` to the dashboard's existing props of the same purpose. The component never resets state after a request; the parent does that on success so a failed request keeps the selection and phrase.

## Behaviour
- **Selection:** native checkboxes inside a 44px (52px under 760px) label target. Revoked keys get no checkbox. Stale ids in `selectedIds` are ignored in counts and requests.
- **Select active keys** selects the first 120 active keys in list order (`selectActiveKeyIds` helper). **Clear selection** empties it. Both stay visible; each is disabled when it would do nothing.
- **Limit:** `limit` is clamped to 1–120. At the limit, unchecked boxes disable, the count reads "120 selected · limit of 120 reached", and a note says how many active keys were left out.
- **Count:** "No keys selected · limit 120" / "3 of 120 selected", polite live region.
- **Confirm step:** "Revoke N API keys" opens an inline `alertdialog`, focus moves to the phrase input. Confirm is enabled only when the input is exactly `REVOKE API KEYS` (case-sensitive, no trimming). Escape or **Keep keys** returns to the toolbar and focuses the bulk button. Checkboxes and row Revoke buttons are disabled/hidden while confirming.
- **Copy:** states that keys "stop working immediately" and "cannot be restored", with a list of the first 5 names plus "and N more".
- **Single revoke** is unchanged from the dashboard: row **Revoke** → inline confirm "Revoke "name"?" → **Revoke key** / **Keep key**. Focus moves to Revoke key; Escape returns focus to the row button.
- **States in words:** Active, Selected, Revoked pills. No dots or colour-only signals.

## Backend notes (not designed here)
- Bulk endpoint should accept at most 120 ids and return per-id results. If some fail, pass `notice={{ tone: 'error', text: '2 of 12 keys could not be revoked. They are still active and still selected.' }}` and keep only failed ids selected.
- Do not add an undo; the copy promises revocation is permanent.

## Checks done
- Class mapping: every `s.*` used exists in the CSS; no unused classes.
- Brace/paren balance on TSX and CSS.
- Prototype at 1440 × 1000 and 390 × 844: no horizontal overflow; long key names wrap; toolbar sticks while the list scrolls; all controls ≥ 44px desktop / 52px phone; keyboard path Tab → checkbox (Space) → Revoke N keys (Enter) → type phrase → Revoke / Escape.
- Not yet done: type-check inside the Next.js app; screen reader pass (VoiceOver, NVDA).
