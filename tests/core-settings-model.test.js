import assert from "node:assert/strict";
import test from "node:test";
import { buildSettingsModel } from "../src/core/settings/model.js";

const t = (key, params) =>
  params !== undefined && Object.hasOwn(params, "title") ? `${key}:${params.title}` : key;
const tModule = (moduleId, key) => `${moduleId}:${key}`;

function moduleOf({
  id,
  labelKey = "title",
  descriptionKey = "description",
  isEnabled = true,
  dependencies = [],
  entry = null,
}) {
  return { id, labelKey, descriptionKey, isEnabled, dependencies, entry };
}

function build(modules, { defaultMode = null, groups = [] } = {}) {
  return buildSettingsModel({
    registry: { modules: () => modules, settingsGroups: () => groups },
    settings: { defaultMode: () => defaultMode },
    t,
    tModule,
  });
}

test("the module rows carry titles, descriptions, dependencies and live warnings", () => {
  const sessions = moduleOf({
    id: "sessions",
    descriptionKey: "sessionsDescription",
    entry: { seed: "", labelKey: "entryTitle" },
  });
  const workspaces = moduleOf({
    id: "workspaces",
    descriptionKey: "workspacesDescription",
    isEnabled: false,
    dependencies: ["sessions"],
    entry: { seed: "+" },
  });
  const model = build([sessions, workspaces], {
    groups: [{ moduleId: "sessions", order: 10, settings: { labelKey: "sessionsSettings", groups: [] } }],
  });

  assert.deepEqual(
    model.modules.map((module) => [module.id, module.title, module.isEnabled]),
    [
      ["sessions", "sessions:title", true],
      ["workspaces", "workspaces:title", false],
    ],
  );
  assert.equal(model.modules[0].description, "sessions:sessionsDescription");
  assert.deepEqual(model.modules[0].dependencies, []);
  assert.deepEqual(model.modules[0].warnings, []);
  assert.equal(model.modules[1].dependencies[0].title, "sessions:title");
  assert.deepEqual(model.modules[1].warnings, []);
  assert.equal(model.groups[0].title, "sessions:title");
  assert.equal(model.groups[0].isEnabled, true);
});

test("a dependency that is switched off raises a warning on the dependent row", () => {
  const sessions = moduleOf({ id: "sessions", isEnabled: false, entry: { seed: "" } });
  const workspaces = moduleOf({
    id: "workspaces",
    dependencies: ["sessions"],
    entry: { seed: "+" },
  });
  const model = build([sessions, workspaces]);
  assert.deepEqual(model.modules[1].warnings, [
    "settingsDependencyOff:sessions:title",
  ]);
  // The provider row explains the consequence in its own copy, not as a warning.
  assert.deepEqual(model.modules[0].warnings, []);
});

test("the default mode picks the first entry, keeps a stored choice and warns when off", () => {
  const sessions = moduleOf({ id: "sessions", entry: { seed: "", labelKey: "entryTitle" } });
  const files = moduleOf({ id: "files", isEnabled: false, entry: { seed: "@" } });

  const initial = build([sessions, files]);
  assert.equal(initial.general.defaultMode.value, "sessions");
  assert.equal(initial.general.defaultMode.warning, null);
  assert.deepEqual(
    initial.general.defaultMode.options.map((option) => [option.value, option.label, option.isEnabled]),
    [
      ["sessions", "sessions:entryTitle", true],
      ["files", "files:title", false],
    ],
  );

  const chosenOff = build([sessions, files], { defaultMode: "files" });
  assert.equal(chosenOff.general.defaultMode.value, "files");
  assert.equal(chosenOff.general.defaultMode.warning, "settingsDefaultModeOff");

  const missing = build([sessions], { defaultMode: "removed" });
  assert.equal(missing.general.defaultMode.value, "removed");
  assert.equal(
    missing.general.defaultMode.warning,
    "settingsDefaultModeUnavailable",
  );
});

test("a module without a description or an entry falls back cleanly", () => {
  const bare = moduleOf({ id: "bare", labelKey: null, descriptionKey: null });
  const model = build([bare]);
  assert.equal(model.modules[0].title, "bare");
  assert.equal(model.modules[0].description, "settingsModuleDescriptionFallback");
  assert.deepEqual(model.general.defaultMode.options, []);
  assert.equal(model.general.defaultMode.value, null);
  assert.equal(model.general.defaultMode.warning, null);
});
