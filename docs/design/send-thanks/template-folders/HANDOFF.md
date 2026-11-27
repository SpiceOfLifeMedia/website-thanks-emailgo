# Template folders design handoff

The folder manager was designed in the existing Claude Design project using the Send, thanks cream, ink, tomato, and honey palette. The full component and stylesheet exports are preserved under `claude-export/`.

## Layout and interactions

- Desktop uses a 320px folder tree beside a flexible template list.
- Phone uses a folder picker and full-height sheets for folder navigation, creation, moving, and deletion. The phone layout switches at 759px and the sheets account for the bottom safe area.
- Folders can be nested. Selecting a folder includes templates from all of its descendants. The disclosure control expands the tree without changing the selection.
- New folders can be top-level or placed inside an existing folder. Moving a template can also return it to All templates.
- Deleting a folder confirms that its descendants will be removed and that assigned templates return to All templates. The existing API carries out that behavior without deleting templates.
- Draft and Published appear as words. Controls use keyboard focus styling, labels, disabled states, and reduced-motion support.

## App integration

`TemplateFolderControls.tsx` is the Claude component with a corrected folder-tree JSX expression and application render hooks for the existing edit, duplicate, publish, delete, and history actions. The dashboard maps the database's `parent_id` and `folder_id` fields to the component props and connects creation, move, and delete handlers to the existing authenticated routes. The app's existing layout and internal API and database names stay in place.

The folder manager is checked by the repository TypeScript check, the 41-test suite, and the production build. The saved source export is retained for design review; the app integration is the compiled implementation.
