# Email, thanks: broadcast composer, Reply-to and Preview text

This package is new and lives in `broadcast-metadata/`. No other project file was changed.

## Files
- `broadcast-metadata/SendThanksBroadcastFields.dc.html`: the live prototype, with four frames:
  - m1a: desktop 1440 × 1000, empty
  - m1b: desktop, malformed reply address
  - m2a: phone 390 × 844, empty
  - m2b: phone, malformed reply address

  The surrounding form (campaign name, From, Subject, Audience, content) is a read-only stand-in so you can see where the new row sits. All values are illustrative.
- `broadcast-metadata/export/BroadcastMetadataFields.tsx`: a controlled React component, plus the exported `validateReplyTo`, `validatePreviewText` and `PREVIEW_TEXT_MAX`.
- `broadcast-metadata/export/broadcast-metadata-fields.module.css`: all of its styles.

## Integration
Place the component after Subject and before Audience in the existing composer:
```tsx
<BroadcastMetadataFields
  replyTo={draft.reply_to ?? ''}
  previewText={draft.preview_text ?? ''}
  onReplyToChange={v => setDraft(d => ({ ...d, reply_to: v }))}
  onPreviewTextChange={v => setDraft(d => ({ ...d, preview_text: v }))}
  errors={serverErrors /* optional: { replyTo?, previewText? } */}
/>
```
- **Saving:** store `reply_to: value.trim() || null` and `preview_text: value || null`, or whatever empty value your payload already uses. The component never changes the payload's shape.
- **Validation:**
  - If you leave `errors` out, the component checks each field after it loses focus, using the exported helpers.
  - If you pass `errors`, the component shows exactly what you pass. Use this for server errors.
  - Before saving, run both helpers. If either returns a message, block the save and focus that field, as the prototype's Save draft does.
- **Disabling:** `disabled` turns off the whole fieldset. `onBlur(field)` is optional.
- **Unchanged:** nothing else in the composer moves. The component renders a `fieldset` with the legend "Optional details".

## Field constraints
**Reply-to** (`reply_to`, optional)
- Accepts one address, `help@yourdomain.example`, or a name and address, `Help desk <help@yourdomain.example>`. The name may be quoted.
- Leading and trailing spaces are ignored.
- Commas, semicolons, line breaks and malformed addresses are rejected, each with its own message.
- The input is `type="text"` with `inputMode="email"`, so phones show the email keyboard while the browser's own email validation never blocks your form's submit. Validation comes only from the helpers or your `errors`.
- This is a format check only. Your server stays the authority.

**Preview text** (`preview_text`, optional)
- One line, up to 500 characters (`PREVIEW_TEXT_MAX`).
- The field is a 2-row textarea, so long text can wrap and stay readable. Pressing Enter is blocked, and pasted line breaks are flagged after blur: "Remove the line breaks. Preview text is one line."
- A live count, for example `54 / 500`, is announced with `aria-live="polite"`. Past 500 it turns bold and the error reads "Shorten to 500 characters or fewer." Text is never cut off silently.

## Responsive behaviour
- **Two columns or one:** the fieldset is a size container (`container-type: inline-size`). At 640px wide or more, the two fields sit side by side (`1fr 1fr`); below that they stack.
- **Desktop:** the row sits inside a 960px form, as a calm paper panel with a line-colour border, a 14px radius and no shadow, so it reads as secondary to the required fields.
- **Phone (below 600px):** inputs are 52px tall and the textarea is at least 88px tall. Labels, helper text and errors wrap, so nothing scrolls sideways at 390px.

## Accessibility
- **Labels:** visible, using `htmlFor`, and each marked "(optional)".
- **Descriptions:** helper text, the count and any error are linked through `aria-describedby`.
- **Errors:** errors appear only after the field loses focus. They use `aria-invalid` and `role="alert"`, a dashed ink border, a tinted background, and a pale-tomato message box with a bold sentence. Colour is never the only signal.
- **Focus:** a 3px ink outline plus a 6px honey ring.
- **Reduced motion:** turns off transitions.

## Visual tokens
| Name | Hex |
| --- | --- |
| paper | `#F4EEE3` |
| chalk | `#FBF9F5` |
| ink | `#1C1916` |
| graphite | `#3D3832` |
| line | `#E3DCD0` |
| honey (focus) | `#F7D56E` |
| error box | `#FFD6C9` |
| invalid field | `#FFF6F2` |

- **Controls:** 2px ink borders with a 12px radius.
- **Type:** Schibsted Grotesk, with IBM Plex Mono for the count.
- **Avoided:** status dots, gradients, decorative icons and provider names.
