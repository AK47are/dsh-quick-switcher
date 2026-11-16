/* History module: the "!" list, its composer bridge and the history command. */

import { defineModule } from "../../core/module.js";
import { HistoryBridge } from "./bridge.js";
import { locale } from "./locale.js";
import { createHistoryStore, createHistoryView } from "./logic.js";

export default defineModule("history", (api) => {
  const store = createHistoryStore();

  /**
   * Pull one older page through the displayed session's controller.
   *
   * The bridge owns the session id it is attached to; the module only needs the
   * binding for that id. A missing binding resolves instead of rejecting, so a
   * stale click after a session switch is a no-op rather than an error.
   */
  function loadOlder(sessionId) {
    const binding = api.services.sessions?.binding?.(sessionId);
    return binding === undefined ? Promise.resolve() : binding.session.loadOlder();
  }

  return {
    apiVersion: 1,
    order: 60,
    labelKey: "historyTitle",
    locale,
    commands: [
      {
        id: "quickSwitcher.history",
        // The id carries a dot because DSH validates persisted keybinding
        // commands against that shape; a bare "history" invalidates the whole
        // keybinding document the first time a user saves a key for it.
        label: () => api.t("historyCommandLabel"),
        aliases: [
          "history",
          "input history",
          "prompt history",
          "历史",
          "输入历史",
          "提示词历史",
        ],
        // Unbound on purpose: the settings row invites the user to record one.
        defaults: {},
        regions: ["page", "editable", "terminal"],
        modals: ["other"],
        resolve() {
          const state = api.panel.getState();
          if (state.open && state.mode === "history") {
            return { status: "handled", run: () => api.panel.close() };
          }
          if (!store.hasSession()) {
            return { status: "blocked", reason: api.t("historyNoSession") };
          }
          return { status: "handled", run: () => api.panel.open({ seed: "!" }) };
        },
      },
    ],
    slots: [
      {
        name: "conversation.input.overlay",
        id: "dsh-quick-switcher-history",
        order: 10,
        inject: () => ({ historyStore: store, loadOlder }),
        component: HistoryBridge,
      },
    ],
    mount(panel) {
      // The draft row stands for what the composer held when the panel opened,
      // not for what it holds after a history row replaced the draft.
      const draftAtOpen = store.getSnapshot().draft;
      const view = createHistoryView({ api, store, draftAtOpen });
      const unsubscribe = store.subscribe(() => panel.notify());
      return {
        matchers: [
          {
            id: "history",
            priority: 10,
            match(query) {
              return query.startsWith("!") ? { filter: query.slice(1) } : null;
            },
            view,
          },
        ],
        dispose: unsubscribe,
      };
    },
  };
});
