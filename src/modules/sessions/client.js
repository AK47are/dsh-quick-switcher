/* Sessions module: the default list, its shared data and the access clock. */

import { defineModule, prefixMatcher } from "../../core/module.js";
import {
  PENDING_ORDER_LEAST_RECENT,
  PENDING_ORDER_MOST_RECENT,
} from "../../core/lib/pending-order.js";
import { createAccessStore } from "./access.js";
import { locale } from "./locale.js";
import { createSessionsPresenter } from "./presenter.js";
import { createSessionRow } from "./row.js";
import { createSessionsView } from "./view.js";

export default defineModule("sessions", (api) => {
  const access = createAccessStore();
  const shared = api.shared.store("session-data");
  const rowFor = createSessionRow({ t: api.t, openSession });
  const SessionsPresenter = createSessionsPresenter({ api, shared, access, rowFor });
  const view = createSessionsView({ api, shared, rowFor });

  function openSession(panel, sessionId) {
    try {
      const result = api.services.uiWorkspace.openSession(sessionId);
      if (result !== null && typeof result === "object" && typeof result.catch === "function") {
        result.catch(() => panel.setError(api.t("openFailed")));
      }
      return true;
    } catch {
      panel.setError(api.t("openFailed"));
      return false;
    }
  }

  return {
    apiVersion: 1,
    order: 10,
    labelKey: "sessionsTitle",
    descriptionKey: "sessionsDescription",
    // The empty seed is the default list; the entry exists so the general open
    // command can be configured to land here from another mode.
    entry: { seed: "", labelKey: "sessionsEntryTitle" },
    locale,
    settings: {
      labelKey: "sessionsTitle",
      groups: [
        {
          fields: [
            {
              id: "pendingOrder",
              type: "choice",
              default: PENDING_ORDER_LEAST_RECENT,
              labelKey: "settingsPendingOrderTitle",
              descriptionKey: "settingsPendingOrderDescription",
              hintKey: "settingsPendingOrderHint",
              options: [
                {
                  value: PENDING_ORDER_LEAST_RECENT,
                  labelKey: "settingsPendingOrderLeastRecent",
                },
                {
                  value: PENDING_ORDER_MOST_RECENT,
                  labelKey: "settingsPendingOrderMostRecent",
                },
              ],
            },
          ],
        },
      ],
    },
    slots: [
      {
        name: "shell.overlay",
        id: "dsh-quick-switcher-sessions",
        order: 1,
        component: SessionsPresenter,
      },
    ],
    mount(panel) {
      const unsubscribe = shared.subscribe(() => panel.notify());
      return {
        matchers: [
          // The catch-all list must never outrank a module that declares a
          // trigger, including an external module with the default priority.
          prefixMatcher("", { id: "sessions", priority: -1000, view }),
        ],
        dispose: unsubscribe,
      };
    },
  };
});

