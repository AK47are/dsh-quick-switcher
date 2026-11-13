/* "#" route: the main panels the sidebar's panel list can open. */

import { filterEntries } from "../data/search.js";

/**
 * Build the panel list.
 *
 * A panel row names one destination, so it carries no status, time, or
 * workspace: the sidebar's own `order` is the only order the route has. The
 * current panel is marked with the same badge a session row uses, because both
 * answer the question of what the main area is showing right now; opening the
 * current panel again would only close the overlay.
 *
 * The route only decides which panels are visible and what the panel does with
 * the chosen id. Selection itself stays the panel's job through
 * `ctx.layout.selectPanel`, so this route needs no service of its own.
 */
export function createPanelsRoute() {
  return {
    id: "panels",
    prefix: "#",
    parse(query) {
      if (!query.startsWith("#")) return null;
      return { filter: query.slice(1) };
    },
    view(parsed, ctx) {
      const entries = Array.isArray(ctx.panelEntries) ? ctx.panelEntries : [];
      const rows = filterEntries(entries, parsed.filter).map(
        ({ entry, positions }) => {
          const current = entry.id === ctx.activePanelId;
          return {
            key: `p:${entry.id}`,
            title: entry.title,
            positions,
            meta:
              entry.idText === ""
                ? []
                : [{ text: entry.idText, className: "dqs-panel-id" }],
            current,
            badge: current ? ctx.t("current") : undefined,
            className: "dqs-panel-row",
            run(activation) {
              if (current) return { type: "close", restoreFocus: true };
              return activation.openPanel(entry.id)
                ? { type: "close", restoreFocus: false }
                : undefined;
            },
          };
        },
      );

      // The two empty cases read differently: a deployment may have registered
      // no panel at all, while a filter that matches nothing is transient.
      let emptyText = null;
      if (rows.length === 0) {
        emptyText =
          entries.length === 0 ? ctx.t("emptyPanels") : ctx.t("emptyPanelMatches");
      }

      return {
        placeholder: ctx.t("placeholderPanels"),
        listLabel: ctx.t("listLabelPanels"),
        searchAria: ctx.t("searchAriaPanels"),
        rows,
        emptyText,
        note: null,
        hints: [
          { keys: ["Enter"], label: ctx.t("hintOpen") },
          { keys: ["Esc"], label: ctx.t("hintClose") },
        ],
        count: ctx.t("countPanels", { count: rows.length }),
      };
    },
  };
}
