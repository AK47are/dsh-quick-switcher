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

/**
 * Load the real client manifest with a React stub.
 *
 * The three UI-bearing modules import React, which node --test cannot resolve
 * and the project deliberately keeps out of devDependencies. esbuild is already
 * the build tool, so the test bundles the manifest once with the stub and
 * imports the result from a temporary directory.
 */
async function loadClientModules() {
  const entry = fileURLToPath(new URL("../src/modules/client-manifest.js", import.meta.url));
  const stub = fileURLToPath(new URL("./react-stub.js", import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [
      {
        name: "react-stub",
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({ path: stub }));
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
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    log: { info() {}, warn() {}, error() {} },
  });

  return { registry, calls, settings, services };
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
  assert.equal(modules.length, 7);

  const harness = createHarness();
  for (const definition of modules) {
    harness.registry.register(definition);
  }

  assert.deepEqual(
    harness.registry.modules().map((module) => module.id),
    ["sessions", "workspaces", "commands", "panels", "files", "history", "ask"],
  );
  assert.deepEqual(
    harness.registry.modules().map((module) => module.order),
    [10, 20, 30, 40, 50, 60, 70],
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
  assert.deepEqual(commands, ["quickSwitcher.history"]);

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
    ["?", "ask"],
  ];
  for (const [query, matcherId] of claims) {
    assert.equal(mounted.resolve(query).matcherId, matcherId, `query ${JSON.stringify(query)}`);
  }
  assert.equal(mounted.providers().length, 0);
  const ask = mounted.contentFor("ask");
  assert.equal(typeof ask.instance.store.find, "function");
  assert.equal(typeof ask.instance.ui.getSnapshot, "function");
  assert.equal(typeof ask.instance.actions.copy, "function");

  mounted.dispose();
  harness.registry.disposeAll();
});
