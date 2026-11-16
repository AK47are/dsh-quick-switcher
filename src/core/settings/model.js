/**
 * Project the settings page from the registry and the settings store.
 *
 * The page renders this model instead of reading module internals, which keeps
 * the dependency warnings and the default-mode fallback testable without React.
 * Every label comes from the module dictionary, so a module that adds its own
 * description appears correctly in both languages; a missing description falls
 * back to the generic core copy.
 */

import { resolveDefaultMode } from "../lib/default-mode.js";

function moduleTitle(module, tModule) {
  if (module !== null && typeof module.labelKey === "string" && module.labelKey !== "") {
    const text = tModule(module.id, module.labelKey);
    if (typeof text === "string" && text !== "") return text;
  }
  return module === null ? "" : module.id;
}

function entryTitle(module, tModule) {
  const key = module.entry?.labelKey ?? module.labelKey;
  if (typeof key === "string" && key !== "") {
    const text = tModule(module.id, key);
    if (typeof text === "string" && text !== "") return text;
  }
  return module.id;
}

/**
 * @param {object} input
 * @param {{ modules: Function, settingsGroups: Function }} input.registry
 * @param {{ defaultMode: Function }} input.settings
 * @param {(key: string, params?: object) => string} input.t core dictionary
 * @param {(moduleId: string, key: string, params?: object) => string} input.tModule module dictionary
 */
export function buildSettingsModel({ registry, settings, t, tModule }) {
  const modules = registry.modules();
  const byId = new Map(modules.map((module) => [module.id, module]));

  const switches = modules.map((module) => {
    const dependencies = module.dependencies.map((id) => {
      const dependency = byId.get(id) ?? null;
      return {
        id,
        installed: dependency !== null,
        isEnabled: dependency === null ? true : dependency.isEnabled !== false,
        title: dependency === null ? id : moduleTitle(dependency, tModule),
      };
    });
    const warnings = dependencies
      .filter((dependency) => dependency.installed && dependency.isEnabled === false)
      .map((dependency) => t("settingsDependencyOff", { title: dependency.title }));
    return {
      id: module.id,
      title: moduleTitle(module, tModule),
      description:
        typeof module.descriptionKey === "string" && module.descriptionKey !== ""
          ? tModule(module.id, module.descriptionKey)
          : t("settingsModuleDescriptionFallback"),
      isEnabled: module.isEnabled !== false,
      dependencies: dependencies.filter((dependency) => dependency.installed),
      warnings,
    };
  });

  const stored = settings.defaultMode();
  const resolved = resolveDefaultMode(modules, stored);
  const options = modules
    .filter((module) => module.entry !== null)
    .map((module) => ({
      value: module.id,
      label: entryTitle(module, tModule),
      isEnabled: module.isEnabled !== false,
    }));
  let defaultModeWarning = null;
  if (resolved.entry === null && stored !== null) {
    defaultModeWarning = t("settingsDefaultModeUnavailable");
  } else if (resolved.entry !== null && resolved.isEnabled !== true) {
    defaultModeWarning = t("settingsDefaultModeOff");
  }

  return {
    modules: switches,
    general: {
      defaultMode: {
        value: resolved.moduleId,
        options,
        warning: defaultModeWarning,
      },
    },
    groups: registry.settingsGroups().map((entry) => {
      const module = byId.get(entry.moduleId) ?? { id: entry.moduleId, isEnabled: true };
      return {
        ...entry,
        title: moduleTitle(module, tModule),
        isEnabled: module.isEnabled !== false,
      };
    }),
  };
}
