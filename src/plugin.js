/* Plugin face: locale, shortcut command, and the overlay slot. */

import { createOpenStore } from "./open-store.js";
import { fileAddress } from "./data/files.js";
import { createRecentCommands } from "./data/recent.js";
import { en, zh } from "./i18n.js";
import { QuickSwitcher } from "./panel/quick-switcher.js";
import { startPointerBaseline } from "./pointer.js";

const NS = "dsh-quick-switcher";
const COMMAND_ID = "quickSwitcher.open";

export const inject = ["slots", "locale", "shortcuts", "uiWorkspace"];

/**
 * The "@" file mode's two DSH calls.
 *
 * Both are looked up when the panel asks, not injected as hard dependencies:
 * a profile that disables file references should still get the session
 * switcher, and it should say the file search is unavailable instead of
 * leaving the whole plugin unapplied while it waits for a service. The names
 * are DSH internal faces, so an upgrade can rename them; the panel absorbs a
 * missing face as an error state rather than a crash.
 */
function createFileCapability(ctx) {
  return {
    async search(sessionId, query, signal) {
      const references = ctx.get("remote")?.fileReferences;
      if (references === undefined) return { ok: false };
      const result = await references.list(sessionId, query, signal);
      if (signal?.aborted === true) return { ok: false };
      return result.ok === true
        ? { ok: true, items: result.value ?? [] }
        : { ok: false };
    },
    open(sessionId, path) {
      const sidebarRight = ctx.get("sidebarRight");
      if (sidebarRight === undefined) {
        throw new Error("dsh-quick-switcher: the right Sidebar is unavailable");
      }
      sidebarRight.openResource(fileAddress(sessionId, path));
    },
  };
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "quick-switcher: dictionaries",
  );
  const t = ctx.locale.bind(NS);
  const store = createOpenStore();
  const recent = createRecentCommands();
  const files = createFileCapability(ctx);

  // The panel must know where the pointer really was before it opened, because
  // the browser replays hover events for elements that appear under a
  // stationary pointer. Tracking starts with the plugin, not with the panel.
  ctx.effect(
    () => startPointerBaseline(document),
    "quick-switcher: pointer baseline",
  );

  ctx.effect(
    () =>
      ctx.shortcuts.register({
        id: COMMAND_ID,
        label: () => t("commandLabel"),
        aliases: [
          "quick switcher",
          "switcher",
          "sessions",
          "switch session",
          "快速切换器",
          "会话",
          "切换会话",
        ],
        defaults: {
          "desktop:macos": { code: "KeyK", modifiers: ["primary", "shift"] },
          "desktop:windows": { code: "KeyK", modifiers: ["primary", "shift"] },
          "desktop:linux": { code: "KeyK", modifiers: ["primary", "shift"] },
          "web:macos": { code: "KeyK", modifiers: ["primary", "shift"] },
          "web:windows": { code: "KeyK", modifiers: ["primary", "shift"] },
        },
        regions: ["page", "editable", "terminal"],
        modals: ["other"],
        resolve: () => ({
          status: "handled",
          run: () => store.toggle(),
        }),
      }),
    "quick-switcher: open command",
  );

  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-quick-switcher",
        locale: NS,
        inject: () => ({
          store,
          uiWorkspace: ctx.uiWorkspace,
          shortcuts: ctx.shortcuts,
          files,
          recent,
        }),
      },
      QuickSwitcher,
    );
    return dispose;
  });
}

export default { name: "dsh-quick-switcher", inject, apply };
