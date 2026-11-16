/* Ask module: the "?" side question, its records, and the detail view. */

import { defineModule, prefixMatcher } from "../../core/module.js";
import { AskDetail, AskFooter } from "./detail.js";
import { locale } from "./locale.js";
import { createAskActions, createAskStore, createAskUi, createAskView } from "./logic.js";

export default defineModule("ask", (api) => {
  // The store outlives every panel mount, so a running answer keeps streaming
  // while the panel is closed and its records survive reopen. The attachment
  // preference is read through the settings scope at request time: a change
  // applies to the next question without rebuilding the store.
  const store = createAskStore({
    translate: (key, params) => api.t(key, params),
    includeAttachments: () => api.settings.get("includeAttachments"),
  });

  api.effect(() => () => store.dispose(), "ask: store");

  return {
    apiVersion: 1,
    order: 70,
    labelKey: "askTitle",
    descriptionKey: "askDescription",
    entry: { seed: "?" },
    locale,
    settings: {
      labelKey: "askTitle",
      groups: [
        {
          fields: [
            {
              id: "includeAttachments",
              type: "boolean",
              default: true,
              labelKey: "settingsAttachmentsTitle",
              descriptionKey: "settingsAttachmentsDescription",
              hintKey: "settingsAttachmentsHint",
            },
          ],
        },
      ],
    },
    views: {
      ask: { content: AskDetail, footer: AskFooter },
    },
    mount(panel) {
      // The feedback store belongs to one panel: a copied label and a running
      // fork must be visible to both the footer and the shell's key handler.
      const ui = createAskUi();
      const actions = createAskActions({
        api,
        store,
        ui,
        panel,
        back: (target) => view.back(target),
      });
      const view = createAskView({ api, store, ui, actions });
      const unsubscribe = store.subscribe(() => panel.notify());
      // A ui change must rebuild the shell's view too, not only the footer:
      // the keydown handler reads `isForking` from that same snapshot.
      const unsubscribeUi = ui.subscribe(() => panel.notify());
      return {
        store,
        ui,
        actions,
        matchers: [
          prefixMatcher("?", {
            id: "ask",
            priority: 10,
            map: (text) => ({ text }),
            view: view.view,
          }),
        ],
        dispose() {
          unsubscribe();
          unsubscribeUi();
          ui.dispose();
          // Closing the panel aborts the session's running answer but keeps
          // what was already received; the record can be reopened and
          // regenerated from the next visit.
          const sessionId = view.getSessionId();
          if (sessionId !== null) store.abortSession(sessionId);
        },
      };
    },
  };
});
