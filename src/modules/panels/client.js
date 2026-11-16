/* Main-panel module: the "#" list of full-page surfaces. */

import { defineModule, prefixMatcher } from "../../core/module.js";
import { filterEntries } from "../../core/lib/search.js";
import { locale } from "./locale.js";
import { PANEL_SLOT, collectPanelEntries, createPanelStore } from "./logic.js";

export default defineModule("panels", (api) => {
  function activeLocaleOf() {
    try {
      return api.services.locale?.getSnapshot?.()?.active ?? "";
    } catch {
      return "";
    }
  }

  const store = createPanelStore(() => {
    let registrations = [];
    try {
      registrations = api.services.slots.entriesOfSlot(PANEL_SLOT) ?? [];
    } catch {
      // An unreadable slot only costs the panels mode; every other module
      // must keep working, so this stays a silent empty list.
      registrations = [];
    }
    return collectPanelEntries(registrations, activeLocaleOf());
  });
  store.refresh();

  // Registrations arrive after this module on a normal start, and labels are
  // functions bound to the locale, so both events rebuild the list. A missing
  // subscription is not fatal: the list simply stops following the live set.
  api.effect(() => {
    try {
      return api.services.slots.subscribe(PANEL_SLOT, () => store.refresh());
    } catch {
      return () => {};
    }
  }, "quick-switcher: panel registrations");
  api.effect(() => {
    try {
      return api.services.locale.subscribe(() => store.refresh());
    } catch {
      return () => {};
    }
  }, "quick-switcher: panel labels");

  function openPanel(panel, panelId) {
    try {
      api.services.layout.selectPanel(panelId);
      panel.close({ restoreFocus: false });
      return true;
    } catch {
      panel.setError(api.t("panelOpenFailed"));
      return false;
    }
  }

  function view(state, panel) {
    const entries = store.getSnapshot();
    const rows = filterEntries(entries, state.filter).map(({ entry, positions }) => {
      const current = entry.id === panel.activePanelId;
      return {
        key: `p:${entry.id}`,
        title: entry.title,
        positions,
        meta:
          entry.idText === ""
            ? []
            : [{ text: entry.idText, className: "dqs-panel-id" }],
        badge: current ? api.t("current") : undefined,
        className: "dqs-panel-row",
        run() {
          if (current) {
            panel.close();
            return;
          }
          openPanel(panel, entry.id);
        },
      };
    });

    // The two empty cases read differently: a deployment may have registered no
    // panel at all, while a filter that matches nothing is transient.
    let emptyText = null;
    if (rows.length === 0) {
      emptyText = entries.length === 0 ? api.t("emptyPanels") : api.t("emptyPanelMatches");
    }

    return {
      placeholder: api.t("placeholderPanels"),
      listLabel: api.t("listLabelPanels"),
      searchAria: api.t("searchAriaPanels"),
      rows,
      emptyText,
      note: null,
      hints: [
        { keys: ["Enter"], label: api.t("hintOpen") },
        { keys: ["Esc"], label: api.t("hintClose") },
      ],
      count: api.t("countPanels", { count: rows.length }),
    };
  }

  return {
    apiVersion: 1,
    order: 40,
    labelKey: "panelsTitle",
    descriptionKey: "panelsDescription",
    entry: { seed: "#" },
    locale,
    mount(panel) {
      const unsubscribe = store.subscribe(() => panel.notify());
      return {
        matchers: [prefixMatcher("#", { id: "panels", priority: 10, view })],
        dispose: unsubscribe,
      };
    },
  };
});
