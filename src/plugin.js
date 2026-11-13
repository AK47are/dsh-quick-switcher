/* Plugin face: locale, commands, and the two overlay entries. */

import { createHistoryStore } from "./history-store.js";
import { createOpenStore } from "./open-store.js";
import { PANEL_SLOT, collectPanelEntries, createPanelStore } from "./data/panels.js";
import { createRecentCommands } from "./data/recent.js";
import { en, zh } from "./i18n.js";
import { HistoryBridge } from "./panel/history-bridge.js";
import { QuickSwitcher } from "./panel/quick-switcher.js";
import { startPointerBaseline } from "./pointer.js";

const NS = "dsh-quick-switcher";
const COMMAND_ID = "quickSwitcher.open";
const HISTORY_COMMAND_ID = "quickSwitcher.history";

export const inject = [
  "slots",
  "locale",
  "shortcuts",
  "sessions",
  "commandUi",
  "uiWorkspace",
  "layout",
];

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
  const historyStore = createHistoryStore();
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

  // The id carries a dot because DSH validates persisted keybinding commands
  // against that shape: a bare "history" registers fine but turns the whole
  // keybinding document invalid the first time a user saves a key for it.
  // `defaults: {}` leaves every platform unbound on purpose; the settings row
  // then invites the user to record their own combination.
  ctx.effect(
    () =>
      ctx.shortcuts.register({
        id: HISTORY_COMMAND_ID,
        label: () => t("historyCommandLabel"),
        aliases: [
          "history",
          "input history",
          "prompt history",
          "历史",
          "输入历史",
          "提示词历史",
        ],
        defaults: {},
        regions: ["page", "editable", "terminal"],
        modals: ["other"],
        resolve: () =>
          historyStore.hasSession()
            ? { status: "handled", run: () => store.requestHistory() }
            : { status: "blocked", reason: t("historyNoSession") },
      }),
    "quick-switcher: history command",
  );

  // The slash command is the in-conversation entry: it consumes `/history`
  // without sending a message and opens the same panel in the same mode.
  ctx.effect(
    () =>
      ctx.commandUi.register({
        name: "history",
        label: () => t("historyCommandLabel"),
        description: () => t("historyCommandDescription"),
        available: () => true,
        ui: {
          kind: "action",
          // The token is consumed synchronously, but the bridge still holds the
          // pre-consumption draft until the next render, so the panel must not
          // treat "/history" as the user's draft.
          run: () => store.requestHistory(false),
        },
      }),
    "quick-switcher: /history",
  );

  // The panel is a root overlay and cannot read a session. This bridge sits in
  // the composer's overlay slot for the displayed session and publishes its
  // prompt window, draft, and pagination flags to the store the dialog reads.
  // It also lends the dialog the two writes it needs: replacing the draft and
  // loading one older page through the session controller.
  ctx.slots.inject("conversation.input.overlay", () => {
    const dispose = ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: "dsh-quick-switcher-history",
        order: 10,
        inject: () => ({
          historyStore,
          loadOlder: (sessionId) => {
            const binding = ctx.sessions.binding(sessionId);
            return binding === undefined
              ? Promise.resolve()
              : binding.session.loadOlder();
          },
        }),
      },
      HistoryBridge,
    );
    return dispose;
  });

  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-quick-switcher",
        locale: NS,
        inject: () => ({
          store,
          history: historyStore,
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
