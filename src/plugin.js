/* Plugin face: locale, shortcut command, and the overlay slot. */

import { createOpenStore } from "./open-store.js";
import { createRecentCommands } from "./data/recent.js";
import { PANEL_SLOT, collectPanelEntries, createPanelStore } from "./data/panels.js";
import { en, zh } from "./i18n.js";
import { QuickSwitcher } from "./panel/quick-switcher.js";
import { startPointerBaseline } from "./pointer.js";

const NS = "dsh-quick-switcher";
const COMMAND_ID = "quickSwitcher.open";

export const inject = ["slots", "locale", "shortcuts", "uiWorkspace", "layout"];

/**
 * Read the active language id without trusting the service.
 *
 * The panel labels are re-evaluated per language, so the reader needs the id
 * a label map would be keyed by. A host without the locale service simply
 * leaves the id empty and the resolver falls back to its own order.
 */
function activeLocaleOf(ctx) {
  try {
    return ctx.locale?.getSnapshot?.()?.active ?? "";
  } catch {
    return "";
  }
}

/**
 * Build the main-panel list from the sidebar's own registry.
 *
 * The panels route lists whatever DSH has registered in `sidebar.panellist`,
 * which is the same list the sidebar draws and the same ids
 * `ctx.layout.selectPanel` accepts. Reading it live means a panel contributed
 * by any plugin appears without this bundle knowing its id, and a plugin that
 * unloads leaves no stale row.
 */
function createPanelList(ctx) {
  const panels = createPanelStore(() => {
    let registrations = [];
    try {
      registrations = ctx.slots.entriesOfSlot(PANEL_SLOT) ?? [];
    } catch {
      // An unreadable slot only costs the panels route; every other route must
      // keep working, so this stays a silent empty list.
      registrations = [];
    }
    return collectPanelEntries(registrations, activeLocaleOf(ctx));
  });
  panels.refresh();

  // Registrations arrive after this plugin on a normal start, and labels are
  // functions bound to the locale, so both events rebuild the list. A missing
  // subscription is not fatal: the list simply stops following the live set
  // instead of taking the whole switcher down.
  ctx.effect(() => {
    try {
      return ctx.slots.subscribe(PANEL_SLOT, () => panels.refresh());
    } catch {
      return () => {};
    }
  }, "quick-switcher: panel registrations");

  ctx.effect(() => {
    try {
      return ctx.locale.subscribe(() => panels.refresh());
    } catch {
      return () => {};
    }
  }, "quick-switcher: panel labels");

  return panels;
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "quick-switcher: dictionaries",
  );
  const t = ctx.locale.bind(NS);
  const store = createOpenStore();
  const recent = createRecentCommands();
  const panels = createPanelList(ctx);

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
          layout: ctx.layout,
          panels,
          recent,
        }),
      },
      QuickSwitcher,
    );
    return dispose;
  });
}

export default { name: "dsh-quick-switcher", inject, apply };
