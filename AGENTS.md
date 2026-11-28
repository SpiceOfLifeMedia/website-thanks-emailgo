## Working style (set by Sam, 28 November 2026)

- Work autonomously. Make the decisions yourself, pick the best option and say why in one line.
- Do not stop to ask questions you can answer yourself.
- Only stop for: a password or 2FA code you don't have, spending money, deleting data, or anything customer-facing going live.
- Plain short English. Anything Sam must paste goes in one code block.
- Where another rule in this file needs Sam's explicit permission, that rule still applies.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
