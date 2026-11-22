/* Workspace-path module: the "=" path mode. */

import { defineModule, prefixMatcher } from "../../core/module.js";
import { locale } from "./locale.js";
import { createWorkspacePathRuntime } from "./logic.js";
import { guessStyle } from "./path.js";

export default defineModule("workspace-path", (api) => {
  /** Same-origin fetch is the only transport the host route needs. */
  function request(path, init) {
    return fetch(path, init);
  }

  /** The workspace the current session belongs to; the mode starts there. */
  function currentWorkspacePath(panel) {
    const list = api.get("workspaces")?.list;
    const snapshot = typeof list?.getSnapshot === "function" ? list.getSnapshot() : null;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const sessionId = panel.currentSessionId;
    if (typeof sessionId !== "string" || sessionId === "") return null;
    for (const item of items) {
      if (!Array.isArray(item?.sessionIds) || !item.sessionIds.includes(sessionId)) continue;
      return typeof item.path === "string" && item.path !== "" ? item.path : null;
    }
    return null;
  }

  return {
    apiVersion: 1,
    order: 25,
    labelKey: "workspacePathTitle",
    descriptionKey: "workspacePathDescription",
    entry: { seed: "=" },
    locale,
    mount(panel) {
      const startDir = currentWorkspacePath(panel);
      const runtime = createWorkspacePathRuntime({
        api,
        panel,
        request,
        startDir,
        style: guessStyle(startDir),
      });
      return {
        matchers: [
          prefixMatcher("=", {
            id: "workspace-path",
            priority: 10,
            map: (text) => ({ text }),
            view: (state) => runtime.view(state.text),
          }),
        ],
        dispose: () => runtime.dispose(),
      };
    },
  };
});
