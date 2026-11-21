import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createTranslator } from "../src/core/i18n.js";
import { en as coreEn, zh as coreZh } from "../src/core/i18n-keys.js";
import { createRegistry } from "../src/core/registry.js";
import { createSettingsStore } from "../src/core/settings/store.js";
import { buildSettingsModel } from "../src/core/settings/model.js";

/**
 * Load the real client manifest with a React stub.
 *
 * The three UI-bearing modules import React, which node --test cannot resolve
 * and the project deliberately keeps out of devDependencies. esbuild is already
 * the build tool, so the test bundles the manifest once with the stub and
 * imports the result from a temporary directory. The DSH primitives are stubbed
 * for the same reason: the host provides them at runtime, and a detail view
 * only needs their type identity to place an element.
 */
async function loadClientModules() {
  const entry = fileURLToPath(new URL("../src/modules/client-manifest.js", import.meta.url));
  const stub = fileURLToPath(new URL("./react-stub.js", import.meta.url));
  const primitives = fileURLToPath(new URL("./primitives-stub.js", import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [
      {
        name: "dsh-stubs",
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({ path: stub }));
          builder.onResolve(
            { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
            () => ({ path: primitives }),
          );
        },
      },
    ],
  });
  const directory = await mkdtemp(join(tmpdir(), "dqs-contract-"));
  const file = join(directory, "client-manifest.mjs");
  try {
    await writeFile(file, result.outputFiles[0].text, "utf8");
    return (await import(pathToFileURL(file).href)).clientModules;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createHarness() {
  const calls = { commands: [], slots: [] };
  const active = { active: "zh" };
  const translator = createTranslator({
    locale: { getSnapshot: () => active, subscribe: () => () => {} },
    dictionaries: { zh: coreZh, en: coreEn },
  });
  const settings = createSettingsStore({ eventTarget: null });
  const catalog = { getSnapshot: () => [], subscribe: () => () => {} };
  const config = { getSnapshot: () => ({ status: "ready" }), subscribe: () => () => {} };
  const services = {
    slots: { entriesOfSlot: () => [], subscribe: () => () => {} },
    locale: { getSnapshot: () => active, subscribe: () => () => {} },
    shortcuts: { catalog, config, registry: { commands: new Map() } },
    sessions: { binding: () => undefined },
    uiWorkspace: { openSession: () => true, startSession: () => true },
    layout: { selectPanel: () => {} },
  };

  let registry = null;
  const panelApi = {
    open() {},
    close() {},
    toggle() {},
    isOpen: () => false,
    getState: () => ({ open: false, seed: "", generation: 0, mode: null, query: "" }),
    subscribe: () => () => {},
    list: () => registry.list(),
  };

  registry = createRegistry({
    t: (moduleId, key, params) => translator.t(moduleId, key, params),
    settings: {
      declare: (moduleId, spec) => settings.declare(moduleId, spec),
      scope: (moduleId) => settings.scope(moduleId),
    },
    locale: { add: (moduleId, dictionaries) => translator.add(moduleId, dictionaries) },
    commands: {
      add: (moduleId, list) => {
        calls.commands.push({ moduleId, list });
        return () => {};
      },
    },
    slots: {
      add: (moduleId, list) => {
        calls.slots.push({ moduleId, list });
        return () => {};
      },
    },
    services,
    get: () => undefined,
    panel: panelApi,
    isModuleEnabled: () => true,
    findLabel: (language, moduleId, key) => translator.findIn(language, moduleId, key),
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    log: { info() {}, warn() {}, error() {} },
  });

  return { registry, calls, settings, services, translator };
}

function panelOf(services) {
  return {
    currentSessionId: "s1",
    activePanelId: null,
    pending: null,
    now: Date.now(),
    query: "",
    t: (key) => key,
    services,
    get: () => undefined,
    close() {},
    setQuery() {},
    focusInput() {},
    notify() {},
    setNotice() {},
    setError() {},
    previousFocus: null,
  };
}

test("the real client manifest registers every module and its contributions", async () => {
  const modules = await loadClientModules();
  assert.equal(modules.length, 8);

  const harness = createHarness();
  for (const definition of modules) {
    harness.registry.register(definition);
  }

  assert.deepEqual(
    harness.registry.modules().map((module) => module.id),
    [
      "sessions",
      "workspaces",
      "new-workspace",
      "commands",
      "panels",
      "files",
      "history",
      "ask",
    ],
  );
  assert.deepEqual(
    harness.registry.modules().map((module) => module.order),
    [10, 20, 25, 30, 40, 50, 60, 70],
  );
  assert.deepEqual(
    harness.registry.settingsGroups().map((entry) => entry.moduleId),
    ["sessions", "ask"],
  );
  assert.equal(harness.registry.viewsOf("ask").moduleId, "ask");
  assert.equal(typeof harness.registry.viewsOf("ask").renderer.content, "function");
  assert.equal(typeof harness.registry.viewsOf("ask").renderer.footer, "function");

  const commands = harness.calls.commands.flatMap((entry) =>
    entry.list.map((command) => command.id),
  );
  assert.deepEqual(commands, [
    "quickSwitcher.mode.sessions",
    "quickSwitcher.mode.workspaces",
    "quickSwitcher.mode.new-workspace",
    "quickSwitcher.mode.commands",
    "quickSwitcher.mode.panels",
    "quickSwitcher.mode.files",
    "quickSwitcher.mode.history",
    "quickSwitcher.mode.ask",
  ]);

  // Every built-in module is reachable directly. A new module that forgets its
  // entry fails here instead of silently missing a shortcut.
  assert.deepEqual(
    harness.registry.modules().map((module) => [module.id, module.entry?.seed ?? null]),
    [
      ["sessions", ""],
      ["workspaces", "+"],
      ["new-workspace", "="],
      ["commands", ">"],
      ["panels", "#"],
      ["files", "@"],
      ["history", "!"],
      ["ask", "?"],
    ],
  );
  assert.deepEqual(
    harness.registry
      .modules()
      .filter((module) => module.dependencies.length > 0)
      .map((module) => [module.id, module.dependencies]),
    [["workspaces", ["sessions"]]],
  );
  for (const module of harness.registry.modules()) {
    assert.equal(typeof module.descriptionKey, "string", `description for ${module.id}`);
  }

  const slots = harness.calls.slots.flatMap((entry) =>
    entry.list.map((slot) => slot.id),
  );
  assert.deepEqual(slots, ["dsh-quick-switcher-sessions", "dsh-quick-switcher-history"]);

  const panel = panelOf(harness.services);
  const mounted = harness.registry.mount(panel);
  const claims = [
    ["", "sessions"],
    [">", "commands"],
    ["!", "history"],
    ["@", "files"],
    ["#", "panels"],
    ["+", "workspaces"],
    ["=", "new-workspace"],
    ["=C:\\Users\\ASUS1\\projects", "new-workspace"],
    ["？", "ask"],
    ["﹖", "ask"],
    ["︖", "ask"],
    ["why?", "ask-suffix"],
    ["why？", "ask-suffix"],
    ["why﹖", "ask-suffix"],
    ["why︖", "ask-suffix"],
    ["@why?", "files"],
    ["!why?", "history"],
    [">why?", "commands"],
    ["#why?", "panels"],
    ["+why?", "workspaces"],
    ["=why?", "new-workspace"],
    ["?why?", "ask"],
  ];
  for (const [query, matcherId] of claims) {
    assert.equal(mounted.resolve(query).matcherId, matcherId, `query ${JSON.stringify(query)}`);
  }
  // The compatible mark is stripped at either end: the question text reaches
  // the view, and the row is the ask row rather than a filter.
  assert.equal(mounted.resolve("？问题").view.rows[0].key, "a:q");
  const suffixed = mounted.resolve("问题？");
  assert.equal(suffixed.matcherId, "ask-suffix");
  assert.equal(suffixed.mode, "ask");
  assert.equal(suffixed.view.rows[0].key, "a:q");
  assert.equal(mounted.resolve("?why?").mode, "ask");
  for (const module of harness.registry.modules()) {
    if (module.entry === null) continue;
    const expected = module.entry.mode ?? module.id;
    const resolved = mounted.resolve(module.entry.seed);
    assert.equal(resolved.matcherId, expected, `entry of ${module.id} reaches its own mode`);
    assert.equal(resolved.mode, expected, `entry of ${module.id} publishes its own mode`);
  }
  const sessionsCommand = harness.calls.commands
    .flatMap((entry) => entry.list)
    .find((command) => command.id === "quickSwitcher.mode.sessions");
  assert.ok(sessionsCommand.aliases.includes("会话列表"));
  assert.ok(sessionsCommand.aliases.includes("Session list"));
  assert.equal(mounted.providers().length, 0);
  const ask = mounted.contentFor("ask");
  assert.equal(typeof ask.instance.store.find, "function");
  assert.equal(typeof ask.instance.ui.getSnapshot, "function");
  assert.equal(typeof ask.instance.actions.copy, "function");

  const buildModel = () =>
    buildSettingsModel({
      registry: harness.registry,
      settings: harness.settings,
      t: (key, params) => harness.translator.t(null, key, params),
      tModule: (moduleId, key, params) => harness.translator.t(moduleId, key, params),
    });
  const model = buildModel();
  assert.equal(model.modules.length, 8);
  assert.equal(model.general.defaultMode.value, "sessions");
  assert.equal(model.general.defaultMode.options.length, 8);
  assert.equal(model.general.defaultMode.warning, null);
  assert.deepEqual(
    model.groups.map((entry) => [entry.moduleId, entry.isEnabled]),
    [
      ["sessions", true],
      ["ask", true],
    ],
  );
  assert.deepEqual(
    model.modules.find((module) => module.id === "workspaces").warnings,
    [],
  );

  assert.equal(harness.registry.setEnabled("sessions", false), true);
  const switchedOff = buildModel();
  assert.equal(
    switchedOff.modules.find((module) => module.id === "sessions").isEnabled,
    false,
  );
  const workspaceWarnings = switchedOff.modules.find(
    (module) => module.id === "workspaces",
  ).warnings;
  assert.equal(workspaceWarnings.length, 1);
  assert.match(workspaceWarnings[0], /会话/u);
  assert.equal(
    switchedOff.general.defaultMode.warning,
    harness.translator.t(null, "settingsDefaultModeOff"),
  );
  assert.equal(harness.registry.setEnabled("sessions", true), true);

  mounted.dispose();
  harness.registry.disposeAll();
});
