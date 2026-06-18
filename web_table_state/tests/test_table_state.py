# -*- coding: utf-8 -*-
from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase, new_test_user


class TestTableState(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user_a = new_test_user(cls.env, login="tsm_user_a", groups="base.group_user")
        cls.user_b = new_test_user(cls.env, login="tsm_user_b", groups="base.group_user")
        cls.State = cls.env["table.state"]

    def test_save_state_creates_and_bumps_version(self):
        """First save creates a record; subsequent saves upsert and bump version."""
        State = self.State.with_user(self.user_a)
        key = "sale.order:list:1"

        res = State.save_state(key, {"columns": {"name": 200}}, version=0)
        self.assertEqual(res["version"], 1)

        rec = State.search([("user_id", "=", self.user_a.id), ("state_key", "=", key)])
        self.assertEqual(len(rec), 1, "save_state must upsert, not duplicate")
        self.assertEqual(rec.payload, {"columns": {"name": 200}})

        # Second save on the same key updates in place and bumps the version.
        res2 = State.save_state(key, {"columns": {"name": 250}}, version=res["version"])
        self.assertEqual(res2["version"], 2)
        rec = State.search([("user_id", "=", self.user_a.id), ("state_key", "=", key)])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.payload, {"columns": {"name": 250}})

    def test_version_is_monotonic_even_with_stale_client(self):
        """A stale/zero client version never lowers the stored version."""
        State = self.State.with_user(self.user_a)
        key = "res.partner:list:7"
        State.save_state(key, {"a": 1}, version=0)  # -> 1
        State.save_state(key, {"a": 2}, version=0)  # -> 2 (client still sends 0)
        res = State.save_state(key, {"a": 3}, version=0)  # -> 3
        self.assertEqual(res["version"], 3)

    def test_load_states_filtered_by_current_user(self):
        """load_states only returns the calling user's records."""
        self.State.with_user(self.user_a).save_state("k1", {"x": 1})
        self.State.with_user(self.user_a).save_state("k2", {"x": 2})
        self.State.with_user(self.user_b).save_state("k1", {"y": 9})

        a_states = self.State.with_user(self.user_a).load_states()
        self.assertEqual(set(a_states), {"k1", "k2"})
        self.assertEqual(a_states["k1"]["payload"], {"x": 1})

        b_states = self.State.with_user(self.user_b).load_states()
        self.assertEqual(set(b_states), {"k1"})
        self.assertEqual(b_states["k1"]["payload"], {"y": 9})

    def test_load_states_keys_filter(self):
        State = self.State.with_user(self.user_a)
        State.save_state("k1", {"x": 1})
        State.save_state("k2", {"x": 2})
        only = State.load_states(keys=["k2"])
        self.assertEqual(set(only), {"k2"})

    def test_record_rule_isolates_users(self):
        """The ir.rule prevents one user from reading another's state via search."""
        state_a = (
            self.State.with_user(self.user_a)
            .create({"state_key": "secret", "payload": {"x": 1}})
        )
        # User B cannot see user A's record through a normal search.
        visible = self.State.with_user(self.user_b).search(
            [("state_key", "=", "secret")]
        )
        self.assertFalse(visible)
        # And cannot read it directly either.
        with self.assertRaises(AccessError):
            state_a.with_user(self.user_b).read(["payload"])
