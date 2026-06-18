# Table State Manager (`web_table_state`)

Per-user, server-synced memory of **list view column widths** and **sort order**
for Odoo 19 - in the spirit of the classic ExtJS `StateManager`.

Odoo recomputes list column widths in memory on every render and persists
nothing: a column you resize snaps back as soon as the columns change, the window
is resized or a filter is removed. Sort order is likewise forgotten between
sessions. **Table State Manager** fixes that and goes one step further than the
usual "remember column width" add-ons by syncing state to the **server**, so a
user's layout follows them across browsers and devices.

## Features

- **Column widths** remembered per user and per view.
- **Sort order** (ascending/descending) remembered and re-applied on open.
- **Server sync with conflict resolution.** State lives in the browser
  (instant, offline-friendly) *and* on the server (durable, cross-device). On
  login the most recent state wins - the server restores a newer layout, the
  browser always wins when it is ahead.
- **No extra round-trips by design.** The saved sort order is compared against
  the order the list was loaded with; a reload is only triggered when they
  diverge (the same cost as one header click), never in a loop.
- **Zero configuration.** Install and resize.

## How it works

| Layer | File | Role |
|-------|------|------|
| Model `table.state` | `models/table_state.py` | One record per (user, view); `load_states` / `save_state` RPC. |
| Service `table_state` | `static/src/services/table_state_service.js` | In-memory cache <-> localStorage <-> server, debounced push, login reconcile. |
| `ListRenderer` patch | `static/src/list/list_renderer_patch.js` | Restore/capture widths, remember/apply sort. |

State key: `"{model}:list:{viewId}"` for main views, `"{model}:x2m:{field}"` for
nested one2many / many2many lists.

## Compatibility

Odoo **19.0** (Community & Enterprise). The technical name `web_table_state` is
kept stable across versions.

## Testing

```bash
odoo-bin -d <db> -i web_table_state --test-enable --stop-after-init
```

Covers `save_state` upsert + monotonic version bump, `load_states` user
filtering, and record-rule isolation between users.

## Known behavior

- **Empty lists:** with no records, Odoo shows its "no content" helper and fills
  the table with sample (ghost) data; widths there are managed by Odoo's sample
  mode and recomputed when the first real record appears. Stored widths apply as
  soon as the list contains data.
- **Resize and the right edge:** resizing freezes explicit column widths, so
  shrinking columns can leave space on the right (the table no longer stretches to
  fill). This is standard Odoo behavior; the last column is not force-expanded, so
  you remain free to shrink any column.

## License

LGPL-3. (c) Software Services BV - https://www.softwareservices.be
