/* Plugin face: locale, shortcut command, and the overlay slot. */

import { createOpenStore } from "./open-store.js";
import { createRecentCommands } from "./data/recent.js";
import { en, zh } from "./i18n.js";
import { QuickSwitcher } from "./panel/quick-switcher.js";

const NS = "dsh-quick-switcher";
const COMMAND_ID = "quickSwitcher.open";

export const inject = ["slots", "locale", "shortcuts", "uiWorkspace"];

export function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "quick-switcher: dictionaries",
  );
  const t = ctx.locale.bind(NS);
  const store = createOpenStore();
  const recent = createRecentCommands();

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
          recent,
        }),
      },
      QuickSwitcher,
    );
    return dispose;
  });
}

export default { name: "dsh-quick-switcher", inject, apply };
