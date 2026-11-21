/* Archive module: the "~" list of sessions DSH keeps out of the default list. */

import { defineModule, prefixMatcher } from "../../core/module.js";
import { locale } from "./locale.js";
import { createArchiveView } from "./view.js";

/**
 * Restore one archived session, optionally opening it afterwards.
 *
 * DSH lets the service open an archived session, but the host gate blocks every
 * step until it is unarchived, so opening without restoring would produce an
 * inert conversation. The pending set keeps a repeated Enter from sending the
 * same unarchive twice while the first request is in flight.
 */
function createRestore({ api, pending }) {
  return async function restore(panel, entry, { open }) {
    if (pending.has(entry.id)) return;
    pending.add(entry.id);
    try {
      await api.services.uiWorkspace.unarchiveSession(entry.id);
    } catch {
      panel.setError(api.t("unarchiveFailed"));
      return;
    } finally {
      pending.delete(entry.id);
    }
    if (!open) return;
    try {
      const result = api.services.uiWorkspace.openSession(entry.id);
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        await result;
      }
      panel.close({ restoreFocus: false });
    } catch {
      panel.setError(api.t("openFailed"));
    }
  };
}

export default defineModule("archive", (api) => {
  // The session list and its rows belong to the sessions module; this module
  // only reads the second list that module publishes.
  const shared = api.shared.store("session-data");
  const pending = new Set();
  const restore = createRestore({ api, pending });
  const view = createArchiveView({ api, shared, restore });

  return {
    apiVersion: 1,
    // Next to the sessions module so the settings switch list keeps the session
    // variants together.
    order: 15,
    labelKey: "archiveTitle",
    descriptionKey: "archiveDescription",
    dependencies: ["sessions"],
    entry: {
      seed: "~",
      // "存档" is not the canonical word, but users search for it; only the
      // visible copy sticks to DSH's 归档.
      aliases: ["已归档", "存档", "archived", "unarchive"],
    },
    locale,
    mount(panel) {
      const unsubscribe = shared.subscribe(() => panel.notify());
      return {
        matchers: [
          // A Chinese IME can emit the fullwidth tilde from the same key, so
          // both spellings reach the same mode.
          prefixMatcher(["~", "～"], { id: "archive", priority: 10, view }),
        ],
        dispose: unsubscribe,
      };
    },
  };
});
