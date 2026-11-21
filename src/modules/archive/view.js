/* The archive list: sessions DSH keeps out of the default list. */

import { filterEntries } from "../../core/lib/search.js";

/**
 * Build the archive view from the snapshot the sessions module publishes.
 *
 * Rows come from the shared `archivedEntries` list and reuse the session row
 * builder, so workspace, time and short id stay identical to the default list.
 * The row's own run would open an archived session, which the host refuses to
 * run, so both actions restore first.
 */
export function createArchiveView({ api, shared, restore }) {
  return function archiveView(state, panel) {
    const data = shared.getSnapshot();
    const entries = data?.archivedEntries ?? [];
    const rowFor = data?.rowFor ?? null;
    const rows =
      rowFor === null
        ? []
        : filterEntries(entries, state.filter).map(({ entry, positions }) => {
            const row = rowFor(entry, panel, { showWorkspace: true, positions });
            return {
              ...row,
              status: null,
              badge: null,
              run: () => restore(panel, entry, { open: true }),
              shiftRun: () => restore(panel, entry, { open: false }),
            };
          });
    return {
      placeholder: api.t("placeholder"),
      listLabel: api.t("listLabel"),
      searchAria: api.t("searchAria"),
      rows,
      emptyText: rows.length === 0 && entries.length > 0 ? api.t("emptyFiltered") : null,
      note: entries.length === 0 ? api.t("empty") : null,
      hints: [
        { keys: ["Shift+Enter"], label: api.t("hintRestore") },
        { keys: ["Esc"], label: api.t("hintClose") },
      ],
      count: api.t("count", { count: rows.length }),
    };
  };
}
