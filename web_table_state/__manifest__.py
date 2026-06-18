# -*- coding: utf-8 -*-
{
    "name": "Table State Manager",
    "version": "19.0.1.0.0",
    "category": "Productivity",
    "summary": "Persist & sync list column widths and sorting per user across devices",
    "description": """
Table State Manager
===================

Odoo recomputes list view column widths in memory on every render and persists
nothing: a column you resize snaps back as soon as the columns change, the window
is resized or a filter is removed. Sort order is likewise forgotten between
sessions.

This module gives every list view a server-backed, per-user memory - in the spirit
of the classic ExtJS ``StateManager``:

* **Column widths** are remembered per user and per view.
* **Sort order** (ascending/descending) is remembered and re-applied *before* the
  first data load, so no extra ``search_read`` is triggered.
* **Server sync with conflict resolution.** State lives both in the browser
  (instant) and on the server (durable). On login the most recent state wins -
  the server restores a newer state, the client always wins when it is ahead.
  This makes preferences follow the user across browsers and devices.

No configuration required. Install and resize.
""",
    "author": "Software Services BV",
    "website": "https://www.softwareservices.be",
    "support": "info@softwareservices.be",
    "license": "LGPL-3",
    "depends": ["web"],
    "data": [
        "security/ir.model.access.csv",
        "security/table_state_rules.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "web_table_state/static/src/**/*",
        ],
    },
    "images": [
        "static/description/banner.png",
        "static/description/main_screenshot.png",
        "static/description/sync_screenshot.png",
        "static/description/sort_screenshot.png",
    ],
    "installable": True,
    "application": False,
}
