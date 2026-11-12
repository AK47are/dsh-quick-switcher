/* ">" route: searchable application commands from the DSH shortcut catalog. */

import { filterEntries } from "../data/search.js";

/**
 * The command list renders the shortcut catalog as rows and hands the chosen
 * id back as an effect. Execution stays in the panel because it needs the
 * service, the pre-open focus, and the close/restore sequence; the route only
 * decides which commands are visible and in what order.
 */
export function createCommandsRoute() {
  return {
    id: "commands",
    prefix: ">",
    parse(query) {
      if (!query.startsWith(">")) return null;
      return { filter: query.slice(1) };
    },
    view(parsed, ctx) {
      const entries = Array.isArray(ctx.commandEntries) ? ctx.commandEntries : [];
      const rows = filterEntries(entries, parsed.filter).map(
        ({ entry, positions }) => ({
          key: `x:${entry.id}`,
          title: entry.label,
          positions,
          meta:
            entry.aliasesText === ""
              ? []
              : [{ text: entry.aliasesText, className: "dqs-command-aliases" }],
          keys: entry.keys,
          badge: entry.isRecent ? ctx.t("recentBadge") : undefined,
          className: "dqs-command-row",
          run() {
            return { type: "command", id: entry.id };
          },
        }),
      );

      let emptyText = null;
      if (rows.length === 0) {
        if (ctx.commandsLoading === true) emptyText = ctx.t("loadingCommands");
        else if (entries.length === 0) emptyText = ctx.t("emptyCommands");
        else emptyText = ctx.t("emptyCommandMatches");
      }

      return {
        placeholder: ctx.t("placeholderCommands"),
        listLabel: ctx.t("listLabelCommands"),
        searchAria: ctx.t("searchAriaCommands"),
        rows,
        emptyText,
        note: null,
        hints: [
          { keys: ["Enter"], label: ctx.t("hintRunCommand") },
          { keys: ["Esc"], label: ctx.t("hintClose") },
        ],
        count: ctx.t("countCommands", { count: rows.length }),
      };
    },
  };
}
