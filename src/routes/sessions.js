/* Default route: every query without a known prefix searches sessions. */

import { filterEntries } from "../data/search.js";
import { sessionRow } from "./session-row.js";

export function createSessionsRoute() {
  return {
    id: "sessions",
    prefix: "",
    parse(query) {
      return { filter: query };
    },
    view(parsed, ctx) {
      const rows = filterEntries(ctx.sessionEntries, parsed.filter).map(
        ({ entry, positions }) => sessionRow(entry, ctx, { showWorkspace: true, positions }),
      );
      return {
        placeholder: ctx.t("placeholder"),
        listLabel: ctx.t("listLabel"),
        searchAria: ctx.t("searchAria"),
        rows,
        emptyText: rows.length === 0 ? ctx.t("empty") : null,
        note: null,
        hints: [
          { keys: ["Enter"], label: ctx.t("hintOpen") },
          { keys: ["Esc"], label: ctx.t("hintClose") },
          { keys: ["+"], label: ctx.t("hintWorkspaceMode") },
        ],
        count: ctx.t("count", { count: rows.length }),
      };
    },
  };
}
