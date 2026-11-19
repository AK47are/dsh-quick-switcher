/* Ask module: the "?" side question, its records, and the detail view. */

import { defineModule, prefixMatcher, suffixMatcher } from "../../core/module.js";
import { AskDetail, AskFooter } from "./detail.js";
import { locale } from "./locale.js";
import { ASK_TRIGGERS, createAskActions, createAskStore, createAskUi, createAskView } from "./logic.js";
import { LOWEST_EFFORT, readChoice } from "./models.js";
import { createAskSettings } from "./settings.js";
import { readAskRecordLimit } from "./storage.js";

export default defineModule("ask", (api) => {
  // The store outlives every panel mount, so a running answer keeps streaming
  // while the panel is closed and its records survive reopen. The attachment,
  // model, and storage-cap preferences are read through the settings scope at
  // request or write time: a change applies without rebuilding the store.
  const store = createAskStore({
    translate: (key, params) => api.t(key, params),
    includeAttachments: () => api.settings.get("includeAttachments"),
    recordLimit: () => readAskRecordLimit(api.settings.get("recordLimit")),
    // A null model means "follow the session"; the host resolves that, so the
    // client only sends a model when one is pinned. The effort is always sent:
    // its lowest default is the point of the setting, and the host floors it on
    // a model that offers fewer levels.
    selection: () => {
      const model = readChoice(api.settings.get("model"));
      const effort = api.settings.get("reasoningEffort");
      return {
        provider: model === null ? "" : model.provider,
        model: model === null ? "" : model.model,
        effort: typeof effort === "string" && effort !== "" ? effort : LOWEST_EFFORT,
      };
    },
  });

  // The settings control renders the cap, the readout of the live record list,
  // and the clear action, so it needs the store instance rather than a copy.
  const askSettings = createAskSettings(api, store);

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
            askSettings.modelField,
            askSettings.effortField,
            {
              id: "includeAttachments",
              type: "boolean",
              default: true,
              labelKey: "settingsAttachmentsTitle",
              descriptionKey: "settingsAttachmentsDescription",
              hintKey: "settingsAttachmentsHint",
            },
            askSettings.recordLimitField,
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
          // Every compatibility spelling of "?" claims the mode at either end.
          // The prefix form is the explicit trigger and wins on a leading mark;
          // the suffix form sits below every trigger (10) and above the
          // catch-all list (-1000), so `@file?` still belongs to the files mode.
          // Both publish the same mode so the mode command treats them as one
          // surface instead of two.
          prefixMatcher(ASK_TRIGGERS, {
            id: "ask",
            priority: 10,
            mode: "ask",
            map: (text) => ({ text }),
            view: view.view,
          }),
          suffixMatcher(ASK_TRIGGERS, {
            id: "ask-suffix",
            priority: 5,
            mode: "ask",
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
