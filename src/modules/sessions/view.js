/* The default list: every query without a better matcher searches sessions. */

import { filterEntries } from "../../core/lib/search.js";

/**
 * Build the default view from the shared session snapshot.
 *
 * The matcher claims every query, so its priority is the lowest in the panel;
 * any module that declares a trigger wins first. Rows come from the shared
 * `session-data` store, which the presenter keeps current while the panel is
 * closed; a snapshot that has not published yet simply renders the empty state
 * until the presenter's first publish asks the shell for one more render.
 */
export function createSessionsView({ api, shared, rowFor }) {
  return function sessionsView(state, panel) {
    const data = shared.getSnapshot();
    const entries = data?.entries ?? [];
    const rowOf = data?.rowFor ?? rowFor;
    const rows = filterEntries(entries, state.filter).map(({ entry, positions }) =>
      rowOf(entry, panel, { showWorkspace: true, positions }),
    );
    return {
      placeholder: api.t("placeholder"),
      listLabel: api.t("listLabel"),
      searchAria: api.t("searchAria"),
      rows,
      emptyText: rows.length === 0 ? api.t("empty") : null,
      note: null,
      hints: [
        { keys: ["Enter"], label: api.t("hintOpen") },
        { keys: ["Esc"], label: api.t("hintClose") },
        { keys: ["+"], label: api.t("hintWorkspaceMode") },
        { keys: ["="], label: api.t("hintWorkspacePathMode") },
        { keys: [">"], label: api.t("hintCommandMode") },
        { keys: ["@"], label: api.t("hintFileMode") },
        { keys: ["!"], label: api.t("hintHistoryMode") },
        { keys: ["#"], label: api.t("hintPanelMode") },
        { keys: ["~"], label: api.t("hintArchiveMode") },
        { keys: ["?"], label: api.t("hintAskMode") },
      ],
      count: api.t("count", { count: rows.length }),
    };
  };
}
