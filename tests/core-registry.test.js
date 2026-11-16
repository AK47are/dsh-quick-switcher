import assert from "node:assert/strict";
import test from "node:test";
import { defineModule } from "../module.js";
import { createRegistry } from "../src/core/registry.js";
import { createSettingsStore } from "../src/core/settings/store.js";

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

function createHarness() {
  const calls = { locale: [], commands: [], slots: [], errors: [] };
  const settings = createSettingsStore({ storage: new MemoryStorage(), eventTarget: null });
  const deps = {
    t: (moduleId, key) => (moduleId === null ? `core:${key}` : `${moduleId}:${key}`),
    settings: {
      declare: (id, spec) => settings.declare(id, spec),
      scope: (id) => settings.scope(id),
    },
    locale: {
      add: (id) => {
        calls.locale.push(id);
        return () => calls.locale.push(`${id}:removed`);
      },
    },
    commands: {
      add: (id) => {
        calls.commands.push(id);
        return () => calls.commands.push(`${id}:removed`);
      },
    },
    slots: {
      add: (id) => {
        calls.slots.push(id);
        return () => calls.slots.push(`${id}:removed`);
      },
    },
    services: { marker: 1 },
    get: () => "optional",
    panel: { open() {} },
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    log: {
      info() {},
      warn() {},
      error: (...args) => calls.errors.push(args),
    },
  };
  return { registry: createRegistry(deps), deps, calls, settings };
}

function panelOf(overrides = {}) {
  return {
    currentSessionId: "session-1",
    pending: null,
    now: 10,
    query: "",
    t: (key) => `panel:${key}`,
    services: {},
    get: () => undefined,
    close() {},
    setQuery() {},
    focusInput() {},
    notify() {},
    setNotice() {},
    setError() {},
    previousFocus: null,
    ...overrides,
  };
}

function claims(id, prefix, priority = 0) {
  return {
    id,
    priority,
    match: (query) => (query.startsWith(prefix) ? { query } : null),
    view: (state) => ({ rows: [{ key: `${id}:row`, title: state.query }] }),
  };
}

function registerModule(registry, id, options = {}) {
  const {
    order = 100,
    matchers = [],
    providers = [],
    views,
    dispose,
    delay = false,
  } = options;
  return registry.register(
    defineModule(id, () => ({
      order,
      views,
      mount: () => {
        if (delay) return undefined;
        return { providers, matchers, dispose };
      },
    })),
  );
}

test("registration runs setup once with a scoped API and applies static contributions", () => {
  const { registry, calls, settings } = createHarness();
  let seen = null;
  const dispose = registry.register(
    defineModule("alpha", (api) => {
      seen = api;
      return {
        order: 10,
        labelKey: "alpha.title",
        locale: { zh: { title: "甲" } },
        settings: {
          labelKey: "alpha.settings",
          groups: [
            {
              fields: [
                { id: "flag", type: "boolean", default: false, labelKey: "alpha.flag" },
              ],
            },
          ],
        },
        commands: [{ id: "alpha.run", label: () => "Run", resolve: () => ({ status: "handled" }) }],
        slots: [{ name: "shell.overlay", id: "alpha", component: () => null }],
        views: { alphaView: { content: () => null } },
      };
    }),
  );

  assert.equal(seen.id, "alpha");
  assert.equal(seen.services.marker, 1);
  assert.equal(seen.get("x"), "optional");
  assert.equal(seen.t("title"), "alpha:title");
  assert.deepEqual(calls.locale, ["alpha"]);
  assert.deepEqual(calls.commands, ["alpha"]);
  assert.deepEqual(calls.slots, ["alpha"]);
  assert.equal(settings.get("alpha", "flag"), false);
  seen.settings.set("flag", true);
  assert.equal(settings.get("alpha", "flag"), true);

  assert.equal(registry.modules()[0].id, "alpha");
  assert.equal(registry.modules()[0].order, 10);
  assert.equal(registry.viewsOf("alphaView").moduleId, "alpha");
  assert.equal(registry.settingsGroups()[0].moduleId, "alpha");
  assert.deepEqual(registry.settingsGroups()[0].settings.labelKey, "alpha.settings");

  dispose();
  assert.equal(registry.modules().length, 0);
  assert.equal(registry.viewsOf("alphaView"), null);
  assert.deepEqual(calls.locale, ["alpha", "alpha:removed"]);
});

test("a duplicate id, a duplicate view kind and a bad definition are rejected", () => {
  const { registry } = createHarness();
  registry.register(defineModule("alpha", () => ({ views: { alphaView: { content: () => null } } })));
  assert.throws(() => registry.register(defineModule("alpha", () => ({}))), /already registered/);
  assert.throws(
    () => registry.register(defineModule("beta", () => ({ views: { alphaView: { content: () => null } } }))),
    /already registered/,
  );
  assert.throws(() => registry.register({ id: "gamma" }), /needs a \{ id, setup \}/);
});

test("a setup throw disposes the effects it already registered", () => {
  const { registry } = createHarness();
  let cleaned = 0;
  assert.throws(
    () =>
      registry.register(
        defineModule("bad", (api) => {
          api.effect(() => () => {
            cleaned += 1;
          });
          throw new Error("boom");
        }),
      ),
    /setup failed/,
  );
  assert.equal(cleaned, 1);
  assert.equal(registry.modules().length, 0);
});

test("an invalid spec is rejected before any contribution is applied", () => {
  const { registry, calls } = createHarness();
  assert.throws(
    () =>
      registry.register(
        defineModule("bad", (api) => {
          api.effect(() => () => {});
          return { apiVersion: 2 };
        }),
      ),
    /apiVersion/,
  );
  assert.deepEqual(calls.commands, []);
  assert.equal(registry.modules().length, 0);
});

test("a failing contribution rolls back the ones already applied", () => {
  const { deps, calls, settings } = createHarness();
  const registry = createRegistry({
    ...deps,
    commands: {
      add() {
        throw new Error("rejected");
      },
    },
  });
  assert.throws(
    () =>
      registry.register(
        defineModule("alpha", () => ({
          locale: { en: { title: "A" } },
          settings: {
            labelKey: "alpha.settings",
            groups: [{ fields: [{ id: "flag", type: "boolean", default: true }] }],
          },
          commands: [{ id: "alpha.run", label: () => "Run", resolve: () => ({}) }],
        })),
      ),
    /registration failed/,
  );
  assert.deepEqual(calls.locale, ["alpha", "alpha:removed"]);
  assert.equal(settings.groups().length, 0);
  assert.equal(registry.modules().length, 0);
});

test("a module without a mount still contributes settings and views", () => {
  const { registry } = createHarness();
  registry.register(
    defineModule("alpha", () => ({
      order: 5,
      settings: {
        labelKey: "alpha.settings",
        groups: [{ fields: [{ id: "flag", type: "boolean", default: true }] }],
      },
      views: { alphaView: { content: () => null } },
    })),
  );
  const mounted = registry.mount(panelOf());
  assert.deepEqual(mounted.providers(), []);
  assert.equal(mounted.resolve("").matcherId, null);
  assert.equal(mounted.contentFor("alphaView").moduleId, "alpha");
});

test("the first matcher that claims the query wins by priority, module order, then declaration", () => {
  const { registry } = createHarness();
  registerModule(registry, "low", { order: 10, matchers: [claims("low", "x", 0)] });
  registerModule(registry, "high", { order: 100, matchers: [claims("high", "x", 5)] });
  const mounted = registry.mount(panelOf());
  assert.equal(mounted.resolve("xray").matcherId, "high");

  const second = createHarness();
  registerModule(second.registry, "late", { order: 20, matchers: [claims("late", "y", 0)] });
  registerModule(second.registry, "early", { order: 10, matchers: [claims("early", "y", 0)] });
  const tie = second.registry.mount(panelOf());
  assert.equal(tie.resolve("yes").matcherId, "early");

  const third = createHarness();
  registerModule(third.registry, "alpha", {
    order: 10,
    matchers: [claims("first", "z", 0), claims("second", "z", 0)],
  });
  const declared = third.registry.mount(panelOf());
  assert.equal(declared.resolve("zip").matcherId, "first");
});

test("a null matcher falls through and an empty query reaches the default view", () => {
  const { registry } = createHarness();
  registerModule(registry, "alpha", {
    order: 10,
    matchers: [
      {
        id: "only-b",
        match: (query) => (query.startsWith("b") ? {} : null),
        view: () => ({ rows: [{ key: "b", title: "B" }] }),
      },
    ],
  });
  const mounted = registry.mount(panelOf());
  const fallback = mounted.resolve("");
  assert.equal(fallback.matcherId, null);
  assert.equal(fallback.view.placeholder, "core:corePlaceholder");
  assert.equal(fallback.view.hints[0].label, "core:hintClose");
  assert.equal(mounted.resolve("b").matcherId, "only-b");
});

test("a matcher that throws or returns a broken view is reported once and skipped", () => {
  const { registry, calls } = createHarness();
  registerModule(registry, "broken", {
    order: 10,
    matchers: [
      {
        id: "throws",
        priority: 9,
        match: () => {
          throw new Error("boom");
        },
        view: () => ({ rows: [] }),
      },
      {
        id: "duplicate-keys",
        priority: 8,
        match: () => ({}),
        view: () => ({
          rows: [
            { key: "x", title: "X" },
            { key: "x", title: "Y" },
          ],
        }),
      },
      claims("ok", "", 0),
    ],
  });
  const mounted = registry.mount(panelOf());
  assert.equal(mounted.resolve("q").matcherId, "ok");
  assert.equal(calls.errors.length, 2);
  mounted.resolve("q");
  assert.equal(calls.errors.length, 2);
});

test("two modules cannot own the same matcher id", () => {
  const { registry, calls } = createHarness();
  registerModule(registry, "alpha", { order: 10, matchers: [claims("shared", "", 0)] });
  registerModule(registry, "beta", { order: 20, matchers: [claims("shared", "", 0)] });
  const mounted = registry.mount(panelOf());
  assert.equal(mounted.resolve("q").moduleId, "alpha");
  assert.equal(calls.errors.length, 1);
  assert.match(String(calls.errors[0][0]), /already owned/);
});

test("providers follow module order and content lookups carry the mounted instance", () => {
  const { registry } = createHarness();
  const P1 = () => null;
  const P2 = () => null;
  registerModule(registry, "late", { order: 20, providers: [P1] });
  registerModule(registry, "early", {
    order: 10,
    providers: [P2],
    views: { alphaView: { content: () => null } },
  });
  const mounted = registry.mount(panelOf());
  assert.deepEqual(
    mounted.providers().map((entry) => entry.moduleId),
    ["early", "late"],
  );
  const content = mounted.contentFor("alphaView");
  assert.equal(content.moduleId, "early");
  assert.equal(typeof content.renderer.content, "function");
  assert.ok(content.instance !== null);
  assert.equal(mounted.contentFor("missing"), null);
});

test("a module registered while the panel is open joins the mounted surface", () => {
  const { registry } = createHarness();
  let notifications = 0;
  const mounted = registry.mount(panelOf({ notify: () => (notifications += 1) }));
  assert.equal(mounted.resolve("b").matcherId, null);
  const remove = registerModule(registry, "beta", { order: 10, matchers: [claims("beta", "b")] });
  assert.equal(notifications, 1);
  assert.equal(mounted.resolve("b").matcherId, "beta");
  remove();
  assert.equal(mounted.resolve("b").matcherId, null);
  assert.equal(notifications, 2);
});

test("closing the panel disposes mounts in reverse order and drops matcher ids", () => {
  const { registry } = createHarness();
  const disposed = [];
  registerModule(registry, "alpha", {
    order: 10,
    matchers: [claims("alpha", "a")],
    dispose: () => disposed.push("alpha"),
  });
  registerModule(registry, "beta", {
    order: 20,
    matchers: [claims("beta", "b")],
    dispose: () => disposed.push("beta"),
  });
  const mounted = registry.mount(panelOf());
  assert.deepEqual(
    registry.list().map((entry) => entry.matchers),
    [["alpha"], ["beta"]],
  );
  mounted.dispose();
  assert.deepEqual(disposed, ["beta", "alpha"]);
  assert.deepEqual(
    registry.list().map((entry) => entry.matchers),
    [[], []],
  );
});

test("a mount that returns an invalid surface releases its own resources", () => {
  const { registry, calls } = createHarness();
  let cleaned = 0;
  registry.register(
    defineModule("broken", () => ({
      order: 10,
      mount: () => ({
        providers: [null],
        dispose: () => {
          cleaned += 1;
        },
      }),
    })),
  );
  const mounted = registry.mount(panelOf());
  assert.equal(cleaned, 1);
  assert.deepEqual(mounted.providers(), []);
  assert.equal(calls.errors.length, 1);
});

test("unregistering a module disposes its live mount and removes its view kind", () => {
  const { registry } = createHarness();
  let disposed = 0;
  const remove = registry.register(
    defineModule("alpha", () => ({
      order: 10,
      views: { alphaView: { content: () => null } },
      mount: () => ({
        matchers: [claims("alpha", "a")],
        dispose: () => {
          disposed += 1;
        },
      }),
    })),
  );
  const mounted = registry.mount(panelOf());
  assert.equal(mounted.resolve("abc").matcherId, "alpha");
  assert.ok(mounted.contentFor("alphaView"));
  remove();
  assert.equal(disposed, 1);
  assert.equal(mounted.resolve("abc").matcherId, null);
  assert.equal(mounted.contentFor("alphaView"), null);
});

test("modules share one named store without importing each other", () => {
  const { registry } = createHarness();
  let writer = null;
  let reader = null;
  registry.register(
    defineModule("writer", (api) => {
      writer = api.shared.store("session-data");
      return {};
    }),
  );
  registry.register(
    defineModule("reader", (api) => {
      reader = api.shared.store("session-data");
      return {};
    }),
  );
  assert.equal(writer, reader);
  assert.equal(reader.getSnapshot(), null);
  const seen = [];
  reader.subscribe((value) => seen.push(value));
  writer.publish({ entries: [1] });
  assert.deepEqual(reader.getSnapshot(), { entries: [1] });
  assert.equal(seen.length, 1);
});

test("a shared store name must be non-empty and disposal clears the bus", () => {
  const { registry } = createHarness();
  let shared = null;
  registry.register(
    defineModule("alpha", (api) => {
      shared = api.shared;
      return {};
    }),
  );
  assert.throws(() => shared.store(""), /non-empty name/);
  const store = shared.store("one");
  store.publish({ a: 1 });
  registry.disposeAll();
  assert.equal(store.getSnapshot(), null);
  assert.throws(() => shared.store("two"), /disposed/);
});

test("disposeAll cleans every module and closes the registry", () => {
  const { registry } = createHarness();
  let cleaned = 0;
  registry.register(
    defineModule("alpha", (api) => {
      api.effect(() => () => {
        cleaned += 1;
      });
      return {};
    }),
  );
  registry.disposeAll();
  assert.equal(cleaned, 1);
  assert.throws(() => registry.register(defineModule("beta", () => ({}))), /disposed/);
});
