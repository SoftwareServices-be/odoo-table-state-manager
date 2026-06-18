/** @odoo-module **/

import { registry } from "@web/core/registry";
import { browser } from "@web/core/browser/browser";

const LS_KEY = "web_table_state";
const SAVE_DEBOUNCE_MS = 350;

function tsmLog(...args) {
    if (browser.localStorage.getItem("tsm_debug")) {
        // eslint-disable-next-line no-console
        console.debug("[TSM:service]", ...args);
    }
}

/**
 * Table State service - the ExtJS-StateManager-style heart of the module.
 *
 * Keeps a per-user map of view states (column widths & sort order) in three
 * places that are kept in sync:
 *
 *   1. an in-memory cache (the source of truth at runtime),
 *   2. localStorage (instant, survives reloads, works offline),
 *   3. the server (durable, shared across browsers and devices).
 *
 * On startup we load both localStorage and the server and reconcile them: the
 * most recent state wins (by ``version``, then ``write_date``). The client may
 * always push - when the browser holds a newer state we send it up.
 *
 * Each entry is shaped ``{ payload, version, write_date }`` where ``payload`` is
 * ``{ columns: {field: widthPx}, order: [{name, asc}] }``.
 */
export const tableStateService = {
    dependencies: ["orm"],

    start(env, { orm }) {
        /** @type {Object<string, {payload: object, version: number, write_date: string|false}>} */
        let cache = readLocalStorage();
        const saveTimers = new Map();
        let ready = false;
        const pending = []; // saves issued before the initial sync completes
        // Resolves once the initial server reconcile is done, so views that
        // mounted before the server answered can re-apply the restored state.
        let resolveReady;
        const readyPromise = new Promise((resolve) => {
            resolveReady = resolve;
        });

        function readLocalStorage() {
            try {
                return JSON.parse(browser.localStorage.getItem(LS_KEY)) || {};
            } catch {
                return {};
            }
        }

        function writeLocalStorage() {
            try {
                browser.localStorage.setItem(LS_KEY, JSON.stringify(cache));
            } catch {
                // Quota or privacy mode - the server copy still keeps us safe.
            }
        }

        /** Is entry ``a`` strictly newer than entry ``b``? */
        function isNewer(a, b) {
            if (!b) {
                return true;
            }
            if (!a) {
                return false;
            }
            if ((a.version || 0) !== (b.version || 0)) {
                return (a.version || 0) > (b.version || 0);
            }
            // Same version: fall back to the timestamp string (lexicographic).
            return (a.write_date || "") > (b.write_date || "");
        }

        function pushToServer(key) {
            const entry = cache[key];
            if (!entry) {
                return Promise.resolve();
            }
            tsmLog("push ->", key, entry.payload);
            return orm
                .call("table.state", "save_state", [key, entry.payload, entry.version])
                .then((res) => {
                    // Adopt the server's authoritative version/timestamp.
                    if (cache[key]) {
                        cache[key].version = res.version;
                        cache[key].write_date = res.write_date;
                        writeLocalStorage();
                    }
                })
                .catch(() => {
                    // Offline or transient error: keep the local copy, retry on
                    // the next save. Never throw into a view render.
                });
        }

        // --- initial reconcile -------------------------------------------------
        orm.call("table.state", "load_states", [])
            .then((serverStates) => {
                const local = cache;
                const merged = {};
                const keys = new Set([
                    ...Object.keys(local),
                    ...Object.keys(serverStates || {}),
                ]);
                const toPush = [];
                for (const key of keys) {
                    const l = local[key];
                    const s = serverStates[key];
                    if (isNewer(l, s)) {
                        merged[key] = l; // browser ahead -> keep & push up
                        toPush.push(key);
                    } else {
                        merged[key] = s; // server ahead (or equal) -> restore
                    }
                }
                cache = merged;
                writeLocalStorage();
                ready = true;
                // Flush any saves that happened during startup, then push the
                // entries where the browser was ahead of the server.
                for (const key of new Set([...pending, ...toPush])) {
                    pushToServer(key);
                }
                pending.length = 0;
                tsmLog("ready, keys =", Object.keys(cache));
                resolveReady();
            })
            .catch(() => {
                // Server unreachable: run purely on the localStorage copy.
                ready = true;
                resolveReady();
            });

        function scheduleSave(key) {
            if (saveTimers.has(key)) {
                browser.clearTimeout(saveTimers.get(key));
            }
            saveTimers.set(
                key,
                browser.setTimeout(() => {
                    saveTimers.delete(key);
                    if (ready) {
                        pushToServer(key);
                    } else {
                        pending.push(key);
                    }
                }, SAVE_DEBOUNCE_MS)
            );
        }

        return {
            /** Resolves once the initial server reconcile has completed. */
            whenReady() {
                return readyPromise;
            },

            /** Return the stored payload for a view key, or null. */
            get(key) {
                return cache[key] ? cache[key].payload : null;
            },

            /**
             * Merge ``partial`` into the stored payload for ``key`` and persist.
             * localStorage is updated synchronously; the server push is debounced.
             */
            save(key, partial) {
                const current = cache[key] || { payload: {}, version: 0 };
                const entry = {
                    payload: { ...current.payload, ...partial },
                    version: (current.version || 0) + 1,
                    write_date: current.write_date || false,
                };
                cache[key] = entry;
                writeLocalStorage();
                scheduleSave(key);
            },
        };
    },
};

registry.category("services").add("table_state", tableStateService);
