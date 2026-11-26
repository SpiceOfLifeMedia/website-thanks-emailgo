# Send, thanks · Templates editor (code export)

React 18 + TypeScript + CSS modules. No other runtime dependencies.

Files
- `TemplatesEditor.tsx` — the screen: app shell (sidebar / phone top bar and tab bar), Templates page head with Draft status words, block tray, email canvas (Visual / Code, Desktop / Phone, Insert variable), Style inspector, phone Blocks and Style bottom sheets.
- `TemplatesEditor.module.css` — the Send, thanks tokens and every style, including the 759px phone breakpoint.
- `blocks.ts` — block model, tokens, demo Good Yarn Co. welcome email, `toEmailHtml()` for the Code view and sending.
- `icons.tsx` — inline stroke icons and the Send, thanks mark.

Usage
```tsx
import { TemplatesEditor } from './templates-editor';

<TemplatesEditor
  templateName="Welcome email"
  onSave={(blocks, theme) => api.saveDraft(blocks, theme)}
  onPreview={(html) => openPreview(html)}
/>
```

Fonts: load Schibsted Grotesk (400–800) and IBM Plex Mono (400–500) once in the app shell; the module only references them.
Variables are written as `{{first_name}}` in block content and render as mono chips on the canvas.
