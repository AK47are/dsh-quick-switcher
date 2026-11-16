import assert from "node:assert/strict";
import test from "node:test";
import { createSharedStores } from "../src/core/shared-store.js";
import commands from "../src/modules/commands/client.js";
import {
  buildCommandEntries,
  commandContext,
  createCommandStore,
  resolveCommand,
} from "../src/modules/commands/logic.js";

const t = (key, params) =>
  params !== undefined && Object.hasOwn(params, "count") ? `${key}:${params.count}` : key;

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

function createShortcuts({ catalog = [], config = { status: "ready" } } = {}) {
  let currentCatalog = catalog;
  let currentConfig = config;
  const catalogListeners = new Set();
  const configListeners = new Set();
  const registry = { commands: new Map() };
  return {
    registry,
    catalog: {
      getSnapshot: () => currentCatalog,
      subscribe(listener) {
        catalogListeners.add(listener);
        return () => catalogListeners.delete(listener);
      },
    },
    config: {
      getSnapshot: () => currentConfig,
      subscribe(listener) {
        configListeners.add(listener);
        return () => configListeners.delete(listener);
      },
    },
    setCatalog(next) {
      currentCatalog = next;
      for (const listener of catalogListeners) listener();
    },
    setConfig(next) {
      currentConfig = next;
      for (const listener of configListeners) listener();
    },
  };
}

function panelOf(overrides = {}) {
  return {
    previousFocus: null,
    close(options) {
      this.closed = options ?? true;
    },
    setError(text) {
      this.error = text;
    },
    notify() {},
    ...overrides,
  };
}

test("recent commands lead, the rest is alphabetical and missing ids are skipped", () => {
  const entries = buildCommandEntries(
    [
      { id: "b", label: "Beta", aliases: ["b"], keys: ["Ctrl+B"] },
      { id: "a", label: "Alpha", aliases: ["run alpha", "运行", "run alpha"], keys: [] },
      { id: "c", label: "Charlie" },
    ],
    ["c", "gone", "b", "b"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["c", "b", "a"],
  );
  assert.equal(entries[0].isRecent, true);
  assert.equal(entries[1].isRecent, true);
  assert.equal(entries[2].aliasesText, "run alpha");
  assert.deepEqual(entries[1].keys, ["Ctrl+B"]);
});

test("resolve reports the command's own status instead of swallowing it", () => {
  const registry = {
    commands: new Map([
      ["handled", { resolve: () => ({ status: "handled", run: () => {} }) }],
      ["blocked", { resolve: () => ({ status: "blocked", reason: "not now" }) }],
      ["pass", { resolve: () => ({ status: "pass" }) }],
      ["throws", { resolve: () => { throw new Error("boom"); } }],
    ]),
  };
  assert.equal(resolveCommand(registry, "missing", {}).status, "missing");
  assert.equal(resolveCommand(registry, "handled", {}).status, "handled");
  assert.deepEqual(resolveCommand(registry, "blocked", {}), {
    status: "blocked",
    reason: "not now",
  });
  assert.equal(resolveCommand(registry, "blocked", {}).reason, "not now");
  assert.equal(resolveCommand(registry, "pass", {}).status, "pass");
  assert.equal(resolveCommand(registry, "throws", {}).status, "failed");
});

test("command context follows focus and classifies the region", () => {
  const terminal = {
    closest(selector) {
      return selector === ".xterm" ? {} : null;
    },
  };
  const editable = {
    closest(selector) {
      return selector.startsWith("input,") ? {} : null;
    },
  };
  assert.deepEqual(commandContext(null), {
    target: undefined,
    region: "page",
    modal: null,
    source: "menu",
  });
  assert.equal(commandContext(terminal).region, "terminal");
  assert.equal(commandContext(editable).region, "editable");
});

test("the store rebuilds on catalog and config changes and stops on dispose", () => {
  const shortcuts = createShortcuts({ catalog: [{ id: "a", label: "Alpha" }] });
  const recent = { read: () => ["a"], record() {} };
  const store = createCommandStore({ shortcuts, recent });
  let notifications = 0;
  const dispose = store.start();
  store.subscribe(() => (notifications += 1));
  assert.deepEqual(
    store.getSnapshot().entries.map((entry) => entry.id),
    ["a"],
  );
  assert.equal(store.getSnapshot().entries[0].isRecent, true);

  shortcuts.setConfig({ status: "loading" });
  assert.equal(store.getSnapshot().loading, true);
  assert.equal(notifications, 1);

  shortcuts.setCatalog([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ]);
  assert.equal(store.getSnapshot().entries.length, 2);
  assert.equal(notifications, 2);
  dispose();
  shortcuts.setCatalog([{ id: "c", label: "Charlie" }]);
  assert.equal(store.getSnapshot().entries.length, 2);
});

test("the command view filters, runs a handled command and records it", async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  try {
    const shortcuts = createShortcuts({
      catalog: [
        { id: "alpha.run", label: "Run Alpha", aliases: ["run alpha"], keys: ["Ctrl+Alt+A"] },
        { id: "beta.run", label: "Run Beta" },
      ],
    });
    const ran = [];
    shortcuts.registry.commands.set("alpha.run", {
      resolve: () => ({ status: "handled", run: () => ran.push("alpha.run") }),
    });
    const bus = createSharedStores();
    const api = {
      id: "commands",
      t,
      services: { shortcuts },
      shared: bus,
      effect: (callback) => {
        const dispose = callback();
        return typeof dispose === "function" ? dispose : () => {};
      },
      settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
      log: {},
    };
    const spec = commands.setup(api);
    const panel = panelOf();
    const mounted = spec.mount(panel);
    const matcher = mounted.matchers[0];
    assert.equal(matcher.match("x"), null);
    const state = matcher.match(">");
    const view = matcher.view(state, panel);
    assert.equal(view.rows.length, 2);
    assert.equal(view.rows[0].key, "x:alpha.run");
    assert.equal(view.placeholder, "placeholderCommands");
    assert.deepEqual(view.rows[0].keys, ["Ctrl+Alt+A"]);

    view.rows[0].run();
    assert.equal(panel.closed, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(ran, ["alpha.run"]);
    assert.equal(JSON.parse(storage.getItem("dsh-quick-switcher.recent-commands.v1"))[0], "alpha.run");

    const reopened = spec.mount(panelOf());
    const recentView = reopened.matchers[0].view(matcher.match(">"), panel);
    assert.equal(recentView.rows[0].badge, "recentBadge");
  } finally {
    globalThis.localStorage = previous;
  }
});

test("blocked, missing and throwing commands keep the panel open with a reason", async () => {
  const shortcuts = createShortcuts({ catalog: [{ id: "blocked.run", label: "Blocked" }] });
  shortcuts.registry.commands.set("blocked.run", {
    resolve: () => ({ status: "blocked", reason: "Not now" }),
  });
  const api = {
    id: "commands",
    t,
    services: { shortcuts },
    shared: createSharedStores(),
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
    log: {},
  };
  const spec = commands.setup(api);
  const panel = panelOf();
  const mounted = spec.mount(panel);
  const matcher = mounted.matchers[0];
  const view = matcher.view(matcher.match(">"), panel);
  view.rows[0].run();
  assert.equal(panel.error, "Not now");
  assert.equal(panel.closed, undefined);

  shortcuts.registry.commands.delete("blocked.run");
  const missing = spec.mount(panelOf());
  const missingPanel = panelOf();
  const missingView = missing.matchers[0].view(matcher.match(">"), missingPanel);
  missingView.rows[0].run();
  assert.equal(missingPanel.error, "commandMissing");
  assert.equal(missingPanel.closed, undefined);
});
