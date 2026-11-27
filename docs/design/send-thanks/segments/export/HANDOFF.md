# Send, thanks: segment builder handoff

This package is new and lives in `segments/`. No other project file was changed.

## Files
- `segments/SendThanksSegments.dc.html`: the live prototype, with four frames:
  - g1a: desktop 1440 × 1000, editing "Pro plan, opened lately"
  - g1b: desktop, a new empty segment
  - g2a: phone 390 × 844, editing
  - g2b: phone, empty

  Counts are illustrative and calculated in the prototype. The tag names, property names and values are made up and not personal.
- `segments/export/SendThanksSegments.tsx`: the controlled `'use client'` component, plus pure helpers: `newRule`, `validateRule`, `validateSegment`, `toFiltersJson`, `describeRule`, `describeFilters` and `countInWords`.
- `segments/export/send-thanks-segments.module.css`: all of its styles.
- `segments/INTEGRATION.md`: a short note on the data model.

## State shape (JSON filters)
```ts
SegmentFilters = { match: 'all' | 'any', groups: { match: 'all' | 'any', rules: SegmentRule[] }[] }
SegmentRule =
  | { kind: 'tag', op: 'has' | 'not_has', value: string }
  | { kind: 'consent', op: 'is', value: 'opted_in' | 'not_recorded' }
  | { kind: 'unsubscribed', op: 'is', value: boolean }
  | { kind: 'property', key: string, type: 'string', op: 'equals'|'not_equals'|'contains'|'is_set'|'is_not_set', value?: string }
  | { kind: 'property', key: string, type: 'number', op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'is_set'|'is_not_set', value?: number }
  | { kind: 'activity', event: 'sent'|'delivered'|'opened'|'clicked'|'bounced'|'complained', op: 'happened'|'not_happened', days: 1..365 }
```
- There are two levels only: groups, and the rules inside them. There's no deeper nesting.
- `toFiltersJson(filters)` gets the filters ready to save:
  - trims strings
  - turns number values into numbers
  - drops `value` for `is_set` and `is_not_set`
  - removes empty groups

Sample rule (g1a):
```json
{ "match": "all", "groups": [ { "match": "all", "rules": [
  { "kind": "property", "key": "plan", "type": "string", "op": "equals", "value": "pro" },
  { "kind": "activity", "event": "opened", "op": "happened", "days": 30 } ] } ] }
```
The summary reads: "Contacts who plan is “pro” and opened an email in the last 30 days."

## Component props
- **Values:** `savedSegments` (`{ id, name, contactCount | null }[]`), `selectedSegmentId`, `name`, `filters`.
- **Live count:** `count`, `countStatus` (`idle` | `loading` | `ready` | `error`) and `totalContacts`.
- **Save state:** `showErrors` (set it to true after the first save attempt), `saving` and `notice`.
- **Layout:** `layout` is `desktop` or `mobile`.
- **Callbacks:** `onNameChange`, `onFiltersChange(nextFilters)`, `onSelectSegment(id)`, `onNewSegment`, `onSave` and `onRetryCount`.

The parent owns all state. Debounce `onFiltersChange` by about 300ms before asking your API for the live count, and pass the result back as `count`.

## Validation
`validateSegment(name, filters)` returns `{ name, rules: Map<"group:rule", message>, count }`. Block the save while `count > 0`. The errors are:
- Name is empty: "Give the segment a name."
- Tag with no name: "Enter a tag name."
- Property with no key: "Enter a property name."
- Property with no value, except for has any value and is empty: "Enter a value to compare with."
- Number property with a value that isn't a number: "Use a number, like 3 or 12.5."
- Activity days not a whole number from 1 to 365: "Use a whole number of days from 1 to 365."

Errors appear once `showErrors` is true. Each error sits under its rule, and that rule gets a dashed border. A banner counts what's left to fix.

## Semantics
- **Inside a group:** `all` means every rule must match (AND). `any` means at least one must match (OR).
- **Between groups:** the top-level `match` combines the groups the same way. The selector only appears once there are two or more groups.
- **No rules:** a segment with no rules means all contacts. The empty state says so.
- **Words between rules:** the joining word, AND or OR, appears between rules in mono and between groups in a honey chip. Grouping is always written out, never shown by colour alone.
- **Activity:** `days` is a rolling window ending now. `happened` means at least one such event in the window; `not_happened` means none. Your API decides how "now" and time zones work.
- **Property:** `equals` and `not_equals` for text should compare without case sensitivity if your API supports it. Say which in your API docs.

## Responsive behaviour
**Desktop**
- A grid of `280px | minmax(0,1fr)`, max-width 1120px: Saved segments on the left, the builder on the right.
- The result card is a grid of `auto | 1fr | auto`: count, summary, then Save segment.
- Each rule row is `180px | 1fr | auto`: rule type, fields (wrapping), Remove. Controls are 44px.

**Phone (`layout="mobile"`)**
- One column. The builder comes first and Saved segments follows.
- The result card stacks.
- Each rule stacks: type, then fields wrapping in rows, then Remove.
- Controls are 52px.
- Every field can shrink and text wraps anywhere, so nothing scrolls sideways at 390px.

## Accessibility
- **Labels:** every control has a visible label or an `aria-label` like "Group 1 rule 2 condition".
- **Grouping:** groups are `fieldset`s with the legend "Group N", and rules are an `ol`.
- **Live count:** sits in an `aria-live="polite"` region and is shown in both numerals and words ("626 · six hundred and twenty-six contacts match").
- **Errors:** use `role="alert"`.
- **Focus:** a 3px ink outline plus a 6px honey ring.
- **Reduced motion:** turns off transitions.
- **Avoided:** status dots, gradients, decorative icons and provider names.
