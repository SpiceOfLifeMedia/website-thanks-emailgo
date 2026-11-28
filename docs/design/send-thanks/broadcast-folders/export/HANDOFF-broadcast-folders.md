# Email, thanks campaign folders

## Design source

Claude Design project: Email, thanks, project 4e50820b-1ab2-45da-bd4c-3d8e8642dd94.
Campaign folder screen and review board are in the broadcast-folders folder. The React component and stylesheet were saved under export. The design uses the Website, thanks palette and type pairing and keeps the app shell intact.

## Behavior

1. Folders are flat, account wide, and have unique names without case sensitivity. A campaign belongs to zero or one folder and remains visible in All campaigns.
2. Creating and renaming a folder trims its name and limits it to 60 characters.
3. Moving a campaign updates only its folder assignment.
4. Deleting a folder returns its campaigns to All campaigns. It does not delete campaigns.
5. Search covers the campaign name and subject. Status filters are All, Drafts, Scheduled, and Sent.
6. Dialogs are keyboard accessible, close with Escape, keep focus inside, return focus to the opener, and use a phone bottom sheet layout.
7. Statuses use words and icons. Touch targets are at least 44px on desktop and 52px on phones.

## App integration

The app mounts the campaign folder workspace where the previous campaign history list appeared. The existing shell and editor remain in place. The implementation preserves the existing edit, delete draft, and cancel queued campaign actions alongside folder management.

Folder data comes from the authenticated broadcast folder and campaign APIs. The account list is filtered in the client by the selected folder, search query, and status. Deleting a folder runs in a transaction that clears folder assignments before removing the folder row.

The design component and stylesheet are stored in export. The app component is an integration adaptation: campaign delivery states and the existing editor actions are retained for this product.

## Validation

Checked locally on 27 November 2026. `npm run check` passed `tsc --noEmit`, all 64 tests, and the optimized Next.js production build. The 1440 × 900 and 390 × 844 screenshots in `docs/design/send-thanks/screenshots/` use synthetic campaign records in an isolated SQLite database. The mobile document width matched its 390px viewport.

No production environment, delivery configuration, DNS, merge, or deployment was changed. The draft pull request remains for Sam to review and merge.
