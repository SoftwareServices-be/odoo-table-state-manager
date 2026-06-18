/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { browser } from "@web/core/browser/browser";
import { ListRenderer } from "@web/views/list/list_renderer";
import { onMounted, onWillUnmount, useEffect } from "@odoo/owl";

/**
 * Patch the list renderer to give every list a per-user, server-synced memory
 * of its column widths and sort order.
 *
 * Odoo's ``useMagicColumnWidths`` hook (web/.../list/column_width_hook.js)
 * computes widths in memory and re-applies them through ``forceColumnWidths`` on
 * every render (a ``useEffect``) *and* asynchronously through a ``ResizeObserver``
 * on the table's parent. It persists nothing and resets the widths when columns
 * change, the window is resized, or a filter is removed.
 *
 * To survive all of those resets we install a ``MutationObserver`` on the table
 * header: whenever anything changes a column's width away from the user's stored
 * value, we re-assert it (except while the user is actively dragging a resize
 * handle). We capture new widths when a resize ends, forget them when the user
 * double-clicks a handle (Odoo's own reset), and remember the sort order.
 *
 * The same ListRenderer is used for nested x2many lists (one2many / many2many).
 * Those are StaticLists (not the model root) and live inside a form, so the
 * env's viewId is the *form* view id. We therefore key x2many lists on the
 * comodel + form view + the set of field columns, and we only restore sort
 * order for genuine root list views.
 *
 * Header cells of field columns carry ``data-name`` (see list_renderer.xml), so
 * ``thead th[data-name]`` matches exactly the resizable data columns and skips
 * the selector / open-form / actions columns.
 */
patch(ListRenderer.prototype, {
    setup() {
        super.setup();
        this.tableState = useService("table_state");
        this._tsmKey = null; // computed on mount, once the DOM/columns exist
        this._tsmSortApplied = false;
        this._tsmObserver = null;

        // The hook returns a fresh object each setup with { resizing,
        // onStartResize, resetWidths }; the template calls those by property at
        // event time, so wrapping them here is picked up. Done once, after the
        // first render, when this.columnWidths exists.
        useEffect(
            () => {
                const cw = this.columnWidths;
                if (!cw || cw.__tsmWrapped) {
                    return;
                }
                const originalStart = cw.onStartResize;
                cw.onStartResize = (ev) => {
                    originalStart(ev);
                    this._tsmCaptureOnRelease();
                };
                const originalReset = cw.resetWidths;
                cw.resetWidths = (...args) => {
                    const result = originalReset(...args);
                    this._tsmForgetWidths(); // double-click reset -> drop stored widths
                    return result;
                };
                cw.__tsmWrapped = true;
            },
            () => []
        );

        this._tsmAlive = false;
        onMounted(() => {
            this._tsmAlive = true;
            this._tsmKey = this._tsmComputeKey();
            this._tsmLog("mounted, key =", this._tsmKey);
            this._tsmApplyWidths(); // from the warm (localStorage) cache, if any
            this._tsmStartObserver();
            // The server reconcile is async: a cold cache (first load, or a
            // different browser) has no data yet at mount. Re-apply once the
            // service is ready, and only then restore sorting (it may reload).
            this.tableState.whenReady().then(() => {
                if (!this._tsmAlive) {
                    return;
                }
                this._tsmApplyWidths();
                this._tsmApplySort();
            });
        });
        onWillUnmount(() => {
            this._tsmAlive = false;
            if (this._tsmObserver) {
                this._tsmObserver.disconnect();
            }
        });
    },

    // --- helpers -----------------------------------------------------------

    _tsmLog(...args) {
        if (browser.localStorage.getItem("tsm_debug")) {
            // eslint-disable-next-line no-console
            console.debug("[TSM]", ...args);
        }
    },

    _tsmHeaderCells() {
        const table = this.tableRef && this.tableRef.el;
        return table ? Array.from(table.querySelectorAll("thead th[data-name]")) : [];
    },

    _tsmIsRootList() {
        const list = this.props.list;
        return !!(list && list.model && list.model.root === list);
    },

    _tsmComputeKey() {
        const list = this.props.list;
        const model = (list && list.resModel) || "unknown";
        const viewId = (this.env.config && this.env.config.viewId) || "na";
        if (this._tsmIsRootList()) {
            return `${model}:list:${viewId}`;
        }
        // Nested x2many list: disambiguate by the set of field columns, so two
        // x2many of the same comodel on one form don't collide.
        const cols = this._tsmHeaderCells()
            .map((th) => th.dataset.name)
            .join(",");
        return `${model}:x2m:${viewId}:${cols}`;
    },

    // --- widths ------------------------------------------------------------

    get _tsmSavedColumns() {
        if (!this._tsmKey) {
            return null;
        }
        const state = this.tableState.get(this._tsmKey);
        return (state && state.columns) || null;
    },

    _tsmApplyWidths() {
        const columns = this._tsmSavedColumns;
        if (!columns) {
            return;
        }
        let applied = 0;
        for (const th of this._tsmHeaderCells()) {
            const width = columns[th.dataset.name];
            // >1px tolerance: avoids sub-pixel oscillation with the observer.
            if (width && Math.abs(th.getBoundingClientRect().width - width) > 1) {
                th.style.width = `${width}px`;
                applied++;
            }
        }
        if (applied) {
            this._tsmLog("applied widths", applied, columns);
        }
    },

    _tsmStartObserver() {
        const table = this.tableRef && this.tableRef.el;
        const thead = table && table.querySelector("thead");
        if (!thead || typeof MutationObserver === "undefined") {
            return;
        }
        this._tsmObserver = new MutationObserver(() => {
            // Don't fight an in-progress drag; the capture-on-release handler
            // will persist the user's final widths instead.
            if (this.columnWidths && this.columnWidths.resizing) {
                return;
            }
            if (this._tsmSavedColumns) {
                this._tsmApplyWidths();
            }
        });
        this._tsmObserver.observe(thead, {
            attributes: true,
            attributeFilter: ["style"],
            subtree: true,
        });
    },

    _tsmCaptureOnRelease() {
        // The hook stops the resize on pointerup; read the settled widths one
        // frame later and persist them (the service debounces the server push).
        const onRelease = () => {
            window.requestAnimationFrame(() => {
                if (!this._tsmKey) {
                    return;
                }
                const columns = {};
                for (const th of this._tsmHeaderCells()) {
                    columns[th.dataset.name] = Math.round(
                        th.getBoundingClientRect().width
                    );
                }
                if (Object.keys(columns).length) {
                    this._tsmLog("capture widths", this._tsmKey, columns);
                    this.tableState.save(this._tsmKey, { columns });
                }
            });
        };
        window.addEventListener("pointerup", onRelease, { once: true });
    },

    _tsmForgetWidths() {
        // User double-clicked a resize handle to reset: clear stored widths so
        // the observer stops re-asserting and Odoo's auto layout takes over.
        if (this._tsmKey) {
            this._tsmLog("forget widths", this._tsmKey);
            this.tableState.save(this._tsmKey, { columns: {} });
        }
    },

    // --- sort --------------------------------------------------------------

    _tsmApplySort() {
        if (this._tsmSortApplied || !this._tsmKey) {
            return;
        }
        this._tsmSortApplied = true;
        // Only restore sorting for genuine root list views (server-side order);
        // x2many lists sort client-side and reopen with their own default.
        const list = this.props.list;
        if (!this._tsmIsRootList() || typeof list.load !== "function") {
            return;
        }
        const state = this.tableState.get(this._tsmKey);
        const order = state && state.order;
        if (!order || !order.length) {
            return;
        }
        const sig = (o) => o.map((x) => `${x.name}:${x.asc ? "a" : "d"}`).join(",");
        if (sig(list.orderBy || []) === sig(order)) {
            return; // already loaded in the stored order -> no extra search_read
        }
        // Diverges from the loaded order: trigger exactly one reload (same cost
        // as a single header click), never in a loop.
        this._tsmLog("restore sort", this._tsmKey, order);
        list.load({ orderBy: order }).catch(() => {});
    },

    onClickSortColumn(column) {
        super.onClickSortColumn(...arguments);
        if (!this._tsmKey || !this._tsmIsRootList()) {
            return;
        }
        const list = this.props.list;
        // super calls list.sortBy(), which updates orderBy asynchronously through
        // model.mutex. Reading orderBy now would give the stale (pre-sort) value,
        // so we queue a no-op behind the sort task and read the settled order.
        const afterSort =
            list.model && list.model.mutex
                ? list.model.mutex.exec(() => {})
                : Promise.resolve();
        Promise.resolve(afterSort).then(() => {
            if (!this._tsmAlive) {
                return;
            }
            const order = (list.orderBy || []).map((o) => ({
                name: o.name,
                asc: !!o.asc,
            }));
            this._tsmLog("save sort", this._tsmKey, order);
            this.tableState.save(this._tsmKey, { order });
        });
    },
});
