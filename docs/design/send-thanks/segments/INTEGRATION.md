# Segments: data model note

**Segment record** (current, unchanged):
```ts
{ id: string; name: string; contact_count: number | null; filters: SegmentFilters }
```

**Filters** are a single JSON object, one level of groups deep:
```ts
{ match: 'all'|'any', groups: [ { match: 'all'|'any', rules: Rule[] } ] }
```

**Rule kinds:**
- **Already supported:** `tag`, `consent` (`opted_in` | `not_recorded`) and `unsubscribed` (boolean).
- **New:**
  - `property`: `{ key, type: 'string'|'number', op, value? }`
  - `activity`: `{ event: sent|delivered|opened|clicked|bounced|complained, op: happened|not_happened, days: 1–365 }`

If existing records store only the three supported filters in a flat form, map them into one group with `match: 'all'`. No new keys are needed for the old kinds.

**Backend work this needs:**
1. Evaluate `property` rules against contact properties: text compares and number compares, plus `is_set` and `is_not_set`.
2. Evaluate `activity` rules from stored email events over a rolling `days` window.
3. Return a live count for draft filters. The component passes nothing else to the API.
4. Validate on the server too; the client rules in `HANDOFF.md` are a convenience.

Any rule `kind` the server doesn't support yet should be rejected with a clear message, not silently ignored.
