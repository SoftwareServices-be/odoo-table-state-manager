# -*- coding: utf-8 -*-
from odoo import api, fields, models


class TableState(models.Model):
    """Per-user UI state for list views (column widths & sort order).

    One record per (user, view). The ``payload`` holds the actual state as JSON,
    e.g.::

        {
            "columns": {"name": 220, "partner_id": 180, "amount_total": 120},
            "order": [{"name": "date_order", "asc": false}]
        }

    ``version`` is a logical clock bumped on every write; together with
    ``write_date`` it lets the client decide whether the server or the browser
    holds the most recent state (see the JS service).
    """

    _name = "table.state"
    _description = "Table UI State (column widths & sort order)"

    user_id = fields.Many2one(
        "res.users",
        string="User",
        required=True,
        index=True,
        ondelete="cascade",
        default=lambda self: self.env.uid,
    )
    state_key = fields.Char(
        string="State Key",
        required=True,
        index=True,
        help="Stable identifier of the view, e.g. 'sale.order:list:42' or, for "
        "nested x2many lists, 'sale.order:o2m:order_line'.",
    )
    payload = fields.Json(string="Payload", default=dict)
    version = fields.Integer(string="Version", default=1)

    _uniq_user_key = models.Constraint(
        "unique(user_id, state_key)",
        "A user can only have one stored state per view.",
    )

    def _serialize(self):
        """Shape returned to the web client."""
        self.ensure_one()
        return {
            "payload": self.payload or {},
            "version": self.version,
            # ISO-ish string: lexicographically comparable, used as a tiebreaker.
            "write_date": fields.Datetime.to_string(self.write_date),
        }

    @api.model
    def load_states(self, keys=None):
        """Return all stored states for the current user.

        :param keys: optional list of ``state_key`` to restrict to.
        :return: ``{state_key: {payload, version, write_date}}``
        """
        domain = [("user_id", "=", self.env.uid)]
        if keys:
            domain.append(("state_key", "in", keys))
        records = self.search(domain)
        return {rec.state_key: rec._serialize() for rec in records}

    @api.model
    def save_state(self, state_key, payload, version=0):
        """Upsert the state for ``state_key`` for the current user.

        The client may always push: we never reject on conflict. The stored
        version is bumped past both the incoming version and the existing one,
        so it keeps growing monotonically.

        :return: ``{version, write_date}`` of the stored record.
        """
        record = self.search(
            [("user_id", "=", self.env.uid), ("state_key", "=", state_key)],
            limit=1,
        )
        new_version = max(int(version or 0), (record.version if record else 0)) + 1
        vals = {"payload": payload or {}, "version": new_version}
        if record:
            record.write(vals)
        else:
            record = self.create(
                dict(vals, user_id=self.env.uid, state_key=state_key)
            )
        return {
            "version": record.version,
            "write_date": fields.Datetime.to_string(record.write_date),
        }
