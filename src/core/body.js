/**
 * Assemble the panel body from the registry, the controller and the browser
 * services.
 *
 * The body is the only place that knows about DSH. It creates the translator,
 * the settings document, the panel controller and the registry, then turns each
 * module declaration into DSH registrations through the contribution sinks. The
 * shell, the controller and the registry never import a DSH service directly.
 */

import { API_VERSION } from "../../module.js";
import { createTranslator } from "./i18n.js";
import { en as coreEn, zh as coreZh } from "./i18n-keys.js";
import { seedForOpen } from "./lib/default-mode.js";
import { createPanelController } from "./panel/controller.js";
import { createOverlay } from "./panel/overlay.js";
import { startPointerBaseline } from "./panel/pointer.js";
import { createRegistry } from "./registry.js";
import { createSettingsSection } from "./settings/page.js";
import { createSettingsStore } from "./settings/store.js";

const NS = "dsh-quick-switcher";
const OPEN_COMMAND_ID = "quickSwitcher.open";

const OPEN_ALIASES = [
  "quick switcher",
  "switcher",
  "sessions",
  "switch session",
  "快速切换器",
  "会话",
  "切换会话",
];

const OPEN_DEFAULTS = {
  "desktop:macos": { code: "KeyK", modifiers: ["primary", "shift"] },
  "desktop:windows": { code: "KeyK", modifiers: ["primary", "shift"] },
  "desktop:linux": { code: "KeyK", modifiers: ["primary", "shift"] },
  "web:macos": { code: "KeyK", modifiers: ["primary", "shift"] },
  "web:windows": { code: "KeyK", modifiers: ["primary", "shift"] },
};

export function createBody({ ctx, modules }) {
  const translator = createTranslator({
    locale: ctx.locale,
    dictionaries: { zh: coreZh, en: coreEn },
  });
  const tCore = (key, params) => translator.t(null, key, params);
  const settings = createSettingsStore();
  const controller = createPanelController();
  const get = (name) => ctx.get?.(name);

  const services = {
    slots: ctx.slots,
    locale: ctx.locale,
    shortcuts: ctx.shortcuts,
    sessions: ctx.sessions,
    uiWorkspace: ctx.uiWorkspace,
    layout: ctx.layout,
  };

  ctx.effect(
    () => ctx.locale.register(NS, { zh: coreZh, en: coreEn }),
    "quick-switcher: core dictionary",
  );

  function addCommands(moduleId, commands) {
    const disposers = [];
    try {
      for (const command of commands) {
        disposers.push(
          ctx.effect(
            () =>
              ctx.shortcuts.register({
                id: command.id,
                label: command.label,
                aliases: command.aliases ?? [],
                defaults: command.defaults ?? {},
                regions: command.regions ?? ["page", "editable", "terminal"],
                modals: command.modals ?? ["other"],
                resolve: command.resolve,
              }),
            `quick-switcher: ${moduleId} command ${command.id}`,
          ),
        );
      }
    } catch (error) {
      // A command rejected halfway (a duplicate id or a conflicting default)
      // must not leave the earlier ones registered: the caller rolls the module
      // back to disabled and a later retry would collide with the leftovers.
      for (const dispose of [...disposers].reverse()) dispose();
      throw error;
    }
    return () => {
      for (const dispose of [...disposers].reverse()) dispose();
    };
  }

  function addSlots(moduleId, slots) {
    const disposers = [];
    try {
      for (const slot of slots) {
        const dispose = ctx.slots.inject(slot.name, () =>
          ctx.slots.register(
            {
              name: slot.name,
              id: slot.id,
              order: slot.order,
              locale: slot.locale,
              inject: slot.inject,
            },
            slot.component,
          ),
        );
        disposers.push(typeof dispose === "function" ? dispose : () => {});
      }
    } catch (error) {
      for (const dispose of [...disposers].reverse()) dispose();
      throw error;
    }
    return () => {
      for (const dispose of [...disposers].reverse()) dispose();
    };
  }

  let registry = null;

  /**
   * Open the panel, letting an explicit seed win over the default-mode setting.
   *
   * The controller closes over this function for the public service and the
   * open command, so both the shortcut and another plugin share one rule. Mode
   * commands always pass their entry seed and therefore bypass the preference.
   */
  function openPanel(options) {
    controller.open({
      seed: seedForOpen(options, registry.modules(), settings.defaultMode()),
    });
  }

  function togglePanel() {
    if (controller.isOpen()) controller.close();
    else openPanel();
  }

  const panelApi = {
    open: (options) => openPanel(options),
    close: () => controller.close(),
    toggle: () => togglePanel(),
    isOpen: () => controller.isOpen(),
    getState: () => controller.getState(),
    subscribe: (listener) => controller.subscribe(listener),
    list: () => registry.list(),
  };

  registry = createRegistry({
    t: (moduleId, key, params) => translator.t(moduleId, key, params),
    settings: {
      declare: (moduleId, spec) => settings.declare(moduleId, spec),
      scope: (moduleId) => settings.scope(moduleId),
    },
    locale: { add: (moduleId, dictionaries) => translator.add(moduleId, dictionaries) },
    commands: { add: addCommands },
    slots: { add: addSlots },
    services,
    get,
    panel: panelApi,
    isModuleEnabled: (moduleId) => settings.moduleSwitch(moduleId),
    findLabel: (language, moduleId, key) => translator.findIn(language, moduleId, key),
    effect: (callback, label) => ctx.effect(callback, label),
    log: console,
  });

  ctx.effect(() => {
    for (const definition of modules) {
      try {
        registry.register(definition);
      } catch (error) {
        // One broken module costs only its own modes; the panel and the other
        // modules stay usable. The contract tests catch the same failure before
        // it reaches a user.
        console.error("[dsh-quick-switcher] module failed to register", error);
      }
    }
    // The switch lives in the settings document, so one subscription covers the
    // settings page, another tab and a module registered while the plugin runs.
    const unsubscribe = settings.subscribe(() => {
      for (const module of registry.modules()) {
        const isEnabled = settings.moduleSwitch(module.id);
        if (module.isEnabled !== isEnabled) registry.setEnabled(module.id, isEnabled);
      }
    });
    return () => {
      unsubscribe();
      registry.disposeAll();
      controller.dispose();
      settings.dispose();
    };
  }, "quick-switcher: modules");

  ctx.effect(
    () =>
      ctx.shortcuts.register({
        id: OPEN_COMMAND_ID,
        label: () => tCore("commandLabel"),
        aliases: OPEN_ALIASES,
        defaults: OPEN_DEFAULTS,
        regions: ["page", "editable", "terminal"],
        modals: ["other"],
        resolve: () => ({
          status: "handled",
          run: () => togglePanel(),
        }),
      }),
    "quick-switcher: open command",
  );

  const Overlay = createOverlay({ registry, controller, t: tCore, services, get });
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: NS,
        order: 0,
        locale: NS,
        inject: () => ({ registry, controller, t: tCore, services, get }),
      },
      Overlay,
    ),
  );

  // The settings page is one section; modules add their groups to it through
  // the same declaration the registry already collected.
  const tModule = (moduleId, key, params) => translator.t(moduleId, key, params);
  const SettingsSection = createSettingsSection({
    settings,
    registry,
    t: tCore,
    tModule,
  });
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: NS,
        order: 60,
        label: () => tCore("settingsNav"),
        locale: NS,
      },
      SettingsSection,
    ),
  );

  ctx.effect(
    () => startPointerBaseline(document),
    "quick-switcher: pointer baseline",
  );

  const service = {
    apiVersion: API_VERSION,
    register: (definition) => registry.register(definition),
    panel: panelApi,
  };
  // The service is what another client plugin injects by name; the guard keeps
  // a host without `provide` from taking the whole switcher down.
  if (typeof ctx.provide === "function") {
    ctx.effect(() => ctx.provide("quickSwitcher", service), "quick-switcher: public service");
  }

  return { registry, controller, settings, translator };
}
