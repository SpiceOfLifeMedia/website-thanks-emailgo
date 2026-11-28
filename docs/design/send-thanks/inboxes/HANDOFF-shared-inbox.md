# Email, thanks: shared receiving inbox handoff

This is an addition. The logo, brand, app shell and existing exports are unchanged.

The project had no existing Receiving screen to work from, so the "Receiving" page header and the workbench are rebuilt from the brief. Keep your real Receiving route and shell, and mount `SharedInboxWorkspace` in its content area.

## Exports
- **`SendThanksInboxThreads.dc.html`:** the live design screen. Props: `mode` is `desktop` or `mobile`; `demo` is `default`, `long`, `reply`, `labels`, `unselected`, `empty`, `loading`, `error`, `noresults`, `list`, `thread` or `actions`. All records in it are fictional and stay in the design file.
- **`Email, thanks Shared Inbox.dc.html`:** the review board, with desktop i1a–i1i and phone i2a–i2g.
- **`export/SharedInboxWorkspace.tsx`:** the `'use client'` component. It holds no data; everything comes from props.
- **`export/shared-inbox-workspace.module.css`:** a CSS module with the Website, thanks tokens.
- **`export/HANDOFF-shared-inbox.md`:** this file.

## Data contract (serializable)
```ts
inboxes: { id, address, name? }[]
activeInboxId: string | null                  // null = All inboxes
folders: { id: 'inbox'|'sent'|'archive'|'spam'|'trash', unreadCount? }[]
activeFolder: FolderId
labels: { id, name }[]                        // existing labels only, no create
threads: ThreadSummary[]                      // current page(s), newest first, already filtered by folder, inbox and query
  ThreadSummary { id, inboxId, folder, subject, counterpart{name?,address}, snippet,
                  latestDirection: 'inbound'|'outbound', lastMessageAt ISO, unread, messageCount, labelIds[] }
listStatus: 'loading'|'ready'|'error'; listError?; hasMore; loadingMore?
query: string                                 // the committed search
selectedThreadId: string | null
thread: ThreadDetail | null; threadStatus: 'idle'|'loading'|'ready'|'error'; threadError?
  ThreadDetail { id, inboxId, folder, subject, unread, labelIds[], counterpart,
                 messages: { id, direction, from, to[], cc?, sentAt ISO, text }[] }   // oldest first, plain text
receivingNotice?: string | null              // undefined = default copy, null = hidden
layout?: 'desktop'|'mobile'; timeZone? = 'Australia/Sydney'; locale? = 'en-AU'; now? ISO (pass from the server)
canMoveToInbox: boolean
```

## Callbacks (all required)
- `onSelectInbox(id|null)`, `onSelectFolder(folder)`: refetch the list, and clear the selection if you need to.
- `onSearch(query)`: runs when the search form is submitted. `''` clears the search. Search applies to the current folder and inbox.
- `onSelectThread(id|null)`: load the thread detail. It's up to you whether opening a thread also marks it read.
- `onLoadMore()`: append the next page. Cursor handling lives in the parent.
- `onRetryList()`, `onRetryThread()`
- `onMarkRead(threadId, read)`
- `onArchive(threadId)`, `onSpam(threadId)`, `onTrash(threadId)`: move the thread to that folder. On phone the thread view closes after a move.
- `onMoveToInbox(threadId)`: used only from Archive. Set `canMoveToInbox: false` to show the button disabled until the backend supports it.
- `onSetLabels(threadId, labelIds)`: replaces the full set of labels on the thread.
- `onReply({ threadId, inboxId, text })`: sends a plain-text reply from the thread's inbox. Resolve once it's accepted; then refresh `thread`.

Every action callback returns a Promise. If it rejects, the error message appears in an alert and the UI stays put. If it resolves, a dismissable notice appears ("Moved “…” to Archive.", "Labels saved.", "Reply sent from …").

## Backend capabilities this still needs
These are not invented in the UI. Each is a required callback and needs a live endpoint:
1. A receiving connection for the account, so inbound mail is stored. Until it's active, the notice explains that new mail only arrives while the connection is active. The UI does not configure it.
2. Thread grouping: stored messages grouped into conversations with `messageCount`, a snippet and the latest timestamp.
3. Folder state per thread (inbox, sent, archive, spam, trash), with unread counts per folder.
4. Per-thread read and unread state.
5. Folder moves: archive, spam, trash and back to Inbox. There's no "Not spam" or "Restore from trash" control, because those weren't specified; add them only once the API supports them.
6. Labels: read the existing list and set labels on a thread. Creating, renaming and deleting labels are not included.
7. Search across subject, sender and body for the current folder and inbox.
8. Sending a reply from an inbox address. This uses your existing sending path and needs no new delivery configuration.
9. Paginated thread lists (cursor-based).

Not included, on purpose: assignment, drafts, attachments, delivery settings and any provider-specific features.

## Layout
**Desktop**
- Mount inside the shell content area with a bounded height (`height: 100%`). Padding is 28px top and 32px on the sides.
- The workbench is a grid of `184px | 384px | minmax(0,1fr)`: folders, conversation list, conversation. It has a 2px ink border, 18px radius and a `0 3px 0` ink shadow. Each pane scrolls on its own.
- **Conversation rows**, line by line:
  - Sender (800 weight when unread) and date.
  - Subject.
  - The newest snippet, with "You: " in front when the latest message was sent by you.
  - An "Unread" honey chip, label chips and "N messages".
- **Selected row:** `#FCEFC0` background with a 4px ink bar on the left.
- **Conversation header:**
  - Subject (22px).
  - A metadata list: With, Inbox, Folder, Messages, Started.
  - Chips for Unread and labels.
  - The toolbar: Reply (tomato), Mark as read/unread, Labels, Archive (or Move to Inbox), Spam, Trash. Each button is 44px and shows its word.
- **Message timeline:**
  - Oldest first. A 32px tile on a 2px line-colour spine, with an inbox icon for received and a send icon for sent mail.
  - Each card shows a "Received" or "Sent" word badge.
  - In conversations longer than four messages, the middle messages fold into a dashed "Show N earlier messages" button.
- **Reply:** a pale-honey bar pinned to the bottom of the conversation pane, showing To and From, a textarea, Send reply and Cancel.

**Phone**
- **List screen:** folders as a 5-column grid of 52px buttons, a 52px search field and a list card. Rows are at least 52px tall.
- **Conversation view:** fixed and full-screen, with safe-area padding.
  - Top bar: a "‹ {Folder}" back button (52px) and the message count.
  - Body scrolls vertically only.
  - Bottom action bar: Reply, Archive and More (52px each).
- **More:** a bottom sheet with Mark as read/unread, Labels, Spam and Trash. Labels opens its own sheet with 52px checkbox rows.
- There's no horizontal overflow: long text wraps anywhere or is clipped with an ellipsis.
- **Shell bottom nav (design only, not part of this component):** with 8 tabs each one is about 47px wide. Labels are 10px with `line-height: 1.1` and wrap onto two lines inside 60px buttons, using soft hyphens (Over‑view, Con‑tacts, Tem‑plates, Do‑mains) rather than an ellipsis. Block list and API keys wrap at the space, and Receiving shows as "Inbox". If your real shell has fewer tabs, keep it as it is.

## Colours
| Use | Value |
| --- | --- |
| Page | paper `#F4EEE3` |
| Cards and panes | chalk `#FBF9F5` |
| Text and borders | ink `#1C1916` |
| Secondary text | graphite `#3D3832` |
| Dividers and spine | line `#E3DCD0` |
| Primary actions (Reply, Save, Send) | tomato `#FF5A36` with ink text |
| Unread chip and current folder | honey `#F7D56E` |
| Selected row, labels panel, reply bar | pale honey `#FCEFC0` |
| Errors | `#FFD6C9` |

Fonts: Schibsted Grotesk throughout. IBM Plex Mono only for counts and the "N UNREAD · N SHOWN" meta line.

Status is always a word (Unread, Received, Sent, folder names). There are no status dots.

## Interactions and accessibility
- **Escape:** closes, in order, the More or Labels sheet or panel, then the reply box, then (on phone) the conversation, going back to the list.
- **Focus:** a 3px ink outline plus a 6px honey ring. ArrowUp/ArrowDown move between conversation rows.
- **Landmarks and labels:**
  - `nav[aria-label=Folders]`, `form[role=search]`, `section[aria-label=Conversations]`.
  - The list is a `ul` labelled "{Folder} conversations". Rows are buttons with `aria-current` and a spoken summary ("Unread. Mia Thompson. Subject. 9:41 am").
  - The actions sit in `toolbar[aria-label="Conversation actions"]`. Messages are an `ol` of `article`s labelled "Received message from …, time".
- **Phone dialogs:** the conversation view and its sheets are `role=dialog aria-modal`. Back gets focus when the view opens, focus returns to the row when it closes, and page scrolling is locked.
- **Live regions:**
  - Loading text uses `role=status`, and lists show `aria-busy` while loading.
  - Errors use `role=alert`.
  - The post-action notice uses `role=status`.
- **Targets:** 44px minimum on desktop and 52px on phone. Folder buttons have `aria-label` "Inbox, 2 unread".
- **Reduced motion:** turns off the conversation view and sheet rise animations, and all transitions.
- **Copy:** no provider names anywhere. Convert any upstream codes into plain words on the server.
