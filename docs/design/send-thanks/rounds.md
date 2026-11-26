# Send, thanks design rounds

## Round 1, Claude Design

Prompt: rebrand the email workspace using the Website Thanks theme and the selected companion wordmark reference 1a. Create the Send, thanks wordmark and comma icon, three dashboard directions, the sending domains, API keys, recent emails, block list and usage meter, plus phone versions. Avoid unrelated display fonts, status dots and generated looking decoration. Provide implementation code, CSS and handoff notes.

### Directions considered

1. **2a Ledger**: an editorial, table forward workspace with restrained colour and tight information density.
2. **2b Workbench, selected**: chunky ink outlined cards, tomato actions, honey active states, and a compact mobile tab bar. It carries the Website Thanks character into a practical operations dashboard.
3. **2c Top bar**: a horizontal navigation model with a broader canvas and compact utility panels.

The chosen direction is 2b Workbench. Claude supplied the requested logo, comma icon, favicon, dashboard TSX and CSS, prototype, phone screens and handoff export. The source wordmark was left unchanged.

## Round 2, actual application review

Claude Design reviewed the implemented desktop and phone screens in the Website Thanks theme. Production data and credentials were excluded from the screenshots.

Desktop screenshot: `screenshots/desktop-1440.png`.

Phone screenshot: `screenshots/mobile-390.png`.

Round 2 scores: desktop 7.5/10, phone 6.5/10. The issue #323 release policy requires a draft PR and the `Rejected: below 8` label when either score is below 8.

Claude's main corrections were to remove empty usage meters while there is no configured cap, remove repeated cap copy, keep card titles on one line, shorten and singularise counts, give recipients more room in the email table, provide full values on clipped email cells, and shorten the phone email action. It also recommended showing three recent emails on phones, adding an account label, and keeping the mobile navigation menu visibly open and usable. These refinements are reflected in the implementation.

Claude confirmed the existing Sent, Queued and Failed labels are honest because the app only records handoff state. Delivered, bounced and complaint events are not available yet, so the UI must not imply that those events are tracked.
