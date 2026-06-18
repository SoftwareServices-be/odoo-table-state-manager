===================
Table State Manager
===================

Per-user, server-synced memory of list view **column widths** and **sort order**
for Odoo 19 - in the spirit of the classic ExtJS ``StateManager``.

Features
========

* Column widths remembered per user and per view.
* Sort order (ascending/descending) remembered and re-applied on open.
* Server-side sync with conflict resolution: state lives in the browser
  (instant, offline-friendly) and on the server (durable, cross-device). On
  login the most recent state wins; the browser may always push its changes up.
* No extra requests by design: a reload for sorting is only triggered when the
  stored order diverges from the order the list was loaded with.

Configuration
=============

None. Install the module and start resizing. The feature applies to every list
view, including nested one2many and many2many lists.

How it works
============

* ``table.state`` (one record per user and view) stores a JSON payload with the
  column widths and the sort order. It exposes ``load_states`` and
  ``save_state`` methods over RPC. A record rule restricts each user to their
  own records.
* A client service keeps an in-memory cache in sync with ``localStorage`` and
  the server, debouncing the server push and reconciling on startup.
* The list renderer is patched to restore and capture column widths (via a
  ``MutationObserver`` that survives Odoo's own width recomputations) and to
  remember and re-apply the sort order.

Data & privacy
==============

The module stores only UI preferences (column widths and sort order) in your own
Odoo database. No data is sent to any third party and no external service is
contacted.

Known behavior
==============

* Empty lists: when a list has no records, Odoo shows its "no content" helper and
  fills the table with sample (ghost) data. Column widths in that placeholder
  state are governed by Odoo's sample mode and are recomputed when the first real
  record appears. Stored widths apply as soon as the list actually contains data.
* Manual resize and the right edge: resizing freezes explicit column widths, so
  shrinking columns can leave empty space on the right of the table (it no longer
  stretches to fill the container). This is standard Odoo behavior. The module
  intentionally does not force-expand the last column, so you stay free to shrink
  any column, including the last one or the selector column.

Credits
=======

Author: Software Services BV (Belgium) - Odoo partner.
Support: info@softwareservices.be
