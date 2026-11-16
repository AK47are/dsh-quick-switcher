/* Command module: searchable DSH application commands. */

import { defineModule } from "../../core/module.js";
import { filterEntries } from "../../core/lib/search.js";
import { createRecentCommands } from "../../data/recent.js";
import { locale } from "./locale.js";
import {
  commandContext,
  createCommandStore,
  resolveCommand,
} from "./logic.js";

export default defineModule("commands", (api) => {
  const recent = createRecentCommands();
  const store = createCommandStore({ shortcuts: api.services.shortcuts, recent });
  api.effect(() => store.start(), "quick-switcher: command catalog");

  /**
   * Run one command the same way the panel always has.
   *
   * `resolve` is called while the overlay is still open so a blocked command
   * keeps the panel and its reason visible. A handled command closes the panel
   * first, then runs on the next task: React unmounts the overlay and restores
   * the pre-open focus, and a command that opens its own modal does not stack on
   * top of a still-mounted dialog.
   */
  function run(entry, panel) {
    const outcome = resolveCommand(
      api.services.shortcuts.registry,
      entry.id,
      commandContext(panel.previousFocus),
    );
    if (outcome.status === "missing") {
      panel.setError(api.t("commandMissing"));
      return;
    }
    if (outcome.status === "failed") {
      console.error("[dsh-quick-switcher] command resolve failed", outcome.error);
      panel.setError(api.t("commandFailed"));
      return;
    }
    if (outcome.status !== "handled") {
      panel.setError(outcome.reason ?? api.t("commandBlocked"));
      return;
    }

    recent.record(entry.id);
    panel.close();
    setTimeout(() => {
      try {
        outcome.run();
      } catch (error) {
        console.error("[dsh-quick-switcher] command failed", error);
      }
    }, 0);
  }

  function view(state, panel) {
    const { entries, loading } = store.getSnapshot();
    const rows = filterEntries(entries, state.filter).map(({ entry, positions }) => ({
      key: `x:${entry.id}`,
      title: entry.label,
      positions,
      meta:
        entry.aliasesText === ""
          ? []
          : [{ text: entry.aliasesText, className: "dqs-command-aliases" }],
      keys: entry.keys,
      badge: entry.isRecent ? api.t("recentBadge") : undefined,
      className: "dqs-command-row",
      run() {
        run(entry, panel);
      },
    }));

    let emptyText = null;
    if (rows.length === 0) {
      if (loading === true) emptyText = api.t("loadingCommands");
      else if (entries.length === 0) emptyText = api.t("emptyCommands");
      else emptyText = api.t("emptyCommandMatches");
    }

    return {
      placeholder: api.t("placeholderCommands"),
      listLabel: api.t("listLabelCommands"),
      searchAria: api.t("searchAriaCommands"),
      rows,
      emptyText,
      note: null,
      hints: [
        { keys: ["Enter"], label: api.t("hintRunCommand") },
        { keys: ["Esc"], label: api.t("hintClose") },
      ],
      count: api.t("countCommands", { count: rows.length }),
    };
  }

  return {
    apiVersion: 1,
    order: 30,
    labelKey: "commandsTitle",
    locale,
    mount(panel) {
      // Recents change while the panel is closed, and the catalog snapshot may
      // have settled since setup; one rebuild per open keeps the list current
      // without subscribing the closed panel to anything.
      store.refresh();
      const unsubscribe = store.subscribe(() => panel.notify());
      return {
        matchers: [
          {
            id: "commands",
            priority: 10,
            match(query) {
              return query.startsWith(">") ? { filter: query.slice(1) } : null;
            },
            view,
          },
        ],
        dispose: unsubscribe,
      };
    },
  };
});
