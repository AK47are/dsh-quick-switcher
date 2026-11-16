import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEY, createSettingsStore } from "../src/core/settings/store.js";

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

class MemoryEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name, event) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event);
  }
}

function declareAlpha(store) {
  return store.declare("alpha", {
    labelKey: "alpha.settings",
    descriptionKey: "alpha.description",
    groups: [
      {
        id: "search",
        labelKey: "alpha.search",
        fields: [
          { id: "enabled", type: "boolean", default: true, labelKey: "alpha.enabled" },
          {
            id: "limit",
            type: "number",
            default: 20,
            min: 1,
            max: 50,
            labelKey: "alpha.limit",
          },
          {
            id: "order",
            type: "choice",
            default: "recent",
            options: [
              { value: "recent", labelKey: "alpha.recent" },
              { value: "name", labelKey: "alpha.name" },
            ],
            labelKey: "alpha.order",
          },
        ],
      },
      {
        fields: [{ id: "plain", type: "boolean", default: false, labelKey: "alpha.plain" }],
      },
    ],
  });
}

test("a declared field reads its default and an undeclared field is undefined", () => {
  const store = createSettingsStore({ storage: new MemoryStorage(), eventTarget: null });
  declareAlpha(store);
  assert.equal(store.get("alpha", "enabled"), true);
  assert.equal(store.get("alpha", "limit"), 20);
  assert.equal(store.get("alpha", "order"), "recent");
  assert.equal(store.get("alpha", "plain"), false);
  assert.equal(store.get("alpha", "missing"), undefined);
  assert.equal(store.get("beta", "enabled"), undefined);
});

test("a grouped field writes at module, group, field and keeps other keys", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ untouched: { keep: true } }));
  const store = createSettingsStore({ storage, eventTarget: null });
  declareAlpha(store);
  store.scope("alpha").set("limit", 31);
  assert.equal(store.get("alpha", "limit"), 31);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    untouched: { keep: true },
    alpha: { search: { limit: 31 } },
  });
  store.scope("alpha").set("plain", true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).alpha, {
    search: { limit: 31 },
    plain: true,
  });
});

test("values outside the declaration fall back or clamp", () => {
  const store = createSettingsStore({ storage: new MemoryStorage(), eventTarget: null });
  declareAlpha(store);
  assert.equal(store.get("alpha", "limit"), 20);
  store.scope("alpha").set("limit", -10);
  assert.equal(store.get("alpha", "limit"), 1);
  store.scope("alpha").set("limit", 999);
  assert.equal(store.get("alpha", "limit"), 50);
  store.scope("alpha").set("limit", Number.NaN);
  assert.equal(store.get("alpha", "limit"), 20);
  store.scope("alpha").set("enabled", "yes");
  assert.equal(store.get("alpha", "enabled"), true);
  store.scope("alpha").set("order", "nope");
  assert.equal(store.get("alpha", "order"), "recent");
});

test("a stored value that no longer validates falls back to the default", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ alpha: { search: { limit: 1000, order: "gone", enabled: "x" } } }),
  );
  const store = createSettingsStore({ storage, eventTarget: null });
  declareAlpha(store);
  assert.equal(store.get("alpha", "limit"), 50);
  assert.equal(store.get("alpha", "order"), "recent");
  assert.equal(store.get("alpha", "enabled"), true);
});

test("the 0.8.0 flat preferences migrate into their module paths once", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      includeAttachments: false,
      pendingOrder: "most-recent",
      legacyOther: { a: 1 },
    }),
  );
  const store = createSettingsStore({ storage, eventTarget: null });
  assert.deepEqual(store.document(), {
    ask: { includeAttachments: false },
    sessions: { pendingOrder: "most-recent" },
    legacyOther: { a: 1 },
  });
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    ask: { includeAttachments: false },
    sessions: { pendingOrder: "most-recent" },
    legacyOther: { a: 1 },
  });

  store.declare("ask", {
    labelKey: "ask.settings",
    groups: [
      {
        fields: [
          { id: "includeAttachments", type: "boolean", default: true, labelKey: "ask.attach" },
        ],
      },
    ],
  });
  store.declare("sessions", {
    labelKey: "sessions.settings",
    groups: [
      {
        fields: [
          {
            id: "pendingOrder",
            type: "choice",
            default: "least-recent",
            options: [
              { value: "least-recent", labelKey: "sessions.least" },
              { value: "most-recent", labelKey: "sessions.most" },
            ],
            labelKey: "sessions.order",
          },
        ],
      },
    ],
  });
  assert.equal(store.get("ask", "includeAttachments"), false);
  assert.equal(store.get("sessions", "pendingOrder"), "most-recent");
});

test("a storage event from another tab replaces the document and notifies", () => {
  const storage = new MemoryStorage();
  const target = new MemoryEventTarget();
  const store = createSettingsStore({ storage, eventTarget: target });
  declareAlpha(store);
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  storage.setItem(STORAGE_KEY, JSON.stringify({ alpha: { search: { limit: 7 } } }));
  target.dispatch("storage", { key: STORAGE_KEY });
  assert.equal(notified, 1);
  assert.equal(store.get("alpha", "limit"), 7);
});

test("dispose removes the declaration index and the storage listener", () => {
  const storage = new MemoryStorage();
  const target = new MemoryEventTarget();
  const store = createSettingsStore({ storage, eventTarget: target });
  const dispose = declareAlpha(store);
  dispose();
  assert.equal(store.get("alpha", "limit"), undefined);
  assert.equal(store.groups().length, 0);
  store.dispose();
  assert.equal(target.listeners.get("storage")?.size ?? 0, 0);
});

test("declaring one module twice throws and a stale disposer keeps the new one", () => {
  const store = createSettingsStore({ storage: new MemoryStorage(), eventTarget: null });
  const first = declareAlpha(store);
  assert.throws(() => declareAlpha(store), /already declared/);
  first();
  const second = declareAlpha(store);
  first();
  assert.equal(store.get("alpha", "limit"), 20);
  second();
});

test("groups report declarations in registration order with their labels", () => {
  const store = createSettingsStore({ storage: new MemoryStorage(), eventTarget: null });
  declareAlpha(store);
  store.declare("beta", {
    labelKey: "beta.settings",
    groups: [{ fields: [{ id: "flag", type: "boolean", default: true, labelKey: "beta.flag" }] }],
  });
  const groups = store.groups();
  assert.deepEqual(
    groups.map((entry) => entry.moduleId),
    ["alpha", "beta"],
  );
  assert.equal(groups[0].labelKey, "alpha.settings");
  assert.equal(store.fieldOf("alpha", "limit").path.join("."), "alpha.search.limit");
});

test("module switches default on, persist off and survive a reload", () => {
  const storage = new MemoryStorage();
  const store = createSettingsStore({ storage, eventTarget: null });
  assert.equal(store.moduleSwitch("alpha"), true);
  store.setModuleSwitch("alpha", false);
  assert.equal(store.moduleSwitch("alpha"), false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).__core, {
    switches: { alpha: false },
  });

  const reloaded = createSettingsStore({ storage, eventTarget: null });
  assert.equal(reloaded.moduleSwitch("alpha"), false);
  assert.equal(reloaded.moduleSwitch("beta"), true);
  reloaded.setModuleSwitch("alpha", true);
  assert.equal(reloaded.moduleSwitch("alpha"), true);
  assert.throws(() => reloaded.setModuleSwitch("", true), /module id/);
  assert.throws(() => reloaded.setModuleSwitch("alpha", "yes"), /boolean/);
});

test("the default open mode is null until chosen and shares the core subtree", () => {
  const storage = new MemoryStorage();
  const store = createSettingsStore({ storage, eventTarget: null });
  assert.equal(store.defaultMode(), null);
  store.setDefaultMode("files");
  assert.equal(store.defaultMode(), "files");
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).__core, { defaultMode: "files" });
  const reloaded = createSettingsStore({ storage, eventTarget: null });
  assert.equal(reloaded.defaultMode(), "files");
  assert.throws(() => reloaded.setDefaultMode(""), /module id/);
});

test("settings sections are expanded by default and remember a collapse", () => {
  const storage = new MemoryStorage();
  const store = createSettingsStore({ storage, eventTarget: null });
  assert.equal(store.isSectionExpanded("modules"), true);
  store.setSectionExpanded("modules", false);
  assert.equal(store.isSectionExpanded("modules"), false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).__core, {
    expanded: { modules: false },
  });

  const reloaded = createSettingsStore({ storage, eventTarget: null });
  assert.equal(reloaded.isSectionExpanded("modules"), false);
  assert.equal(reloaded.isSectionExpanded("general"), true);
  assert.throws(() => reloaded.setSectionExpanded("", false), /section id/);
  assert.throws(() => reloaded.setSectionExpanded("modules", "no"), /boolean/);
});

test("a storage event applies a switch and a default mode written by another tab", () => {
  const storage = new MemoryStorage();
  const target = new MemoryEventTarget();
  const store = createSettingsStore({ storage, eventTarget: target });
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      __core: {
        switches: { files: false },
        defaultMode: "commands",
        expanded: { modules: false },
      },
    }),
  );
  target.dispatch("storage", { key: STORAGE_KEY });
  assert.equal(notified, 1);
  assert.equal(store.moduleSwitch("files"), false);
  assert.equal(store.defaultMode(), "commands");
  assert.equal(store.isSectionExpanded("modules"), false);
});
