import assert from "node:assert/strict";
import test from "node:test";
import panels from "../src/modules/panels/client.js";
import {
  collectPanelEntries,
  createPanelStore,
  resolvePanelLabel,
} from "../src/modules/panels/logic.js";

const t = (key, params) =>
  params !== undefined && Object.hasOwn(params, "count") ? `${key}:${params.count}` : key;

function panelOf(overrides = {}) {
  return {
    activePanelId: null,
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

function createHarness({ registrations = [], active = "zh" } = {}) {
  const state = { registrations, active };
  const slotListeners = new Set();
  const localeListeners = new Set();
  const selected = [];
  const api = {
    id: "panels",
    t,
    services: {
      slots: {
        entriesOfSlot: () => state.registrations,
        subscribe: (_name, listener) => {
          slotListeners.add(listener);
          return () => slotListeners.delete(listener);
        },
      },
      locale: {
        getSnapshot: () => ({ active: state.active }),
        subscribe: (listener) => {
          localeListeners.add(listener);
          return () => localeListeners.delete(listener);
        },
      },
      layout: {
        selectPanel(panelId) {
          selected.push(panelId);
        },
      },
    },
    shared: { store: () => ({ getSnapshot: () => null, publish() {}, subscribe: () => () => {} }) },
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
    log: {},
  };
  const spec = panels.setup(api);
  return {
    api,
    spec,
    selected,
    setRegistrations(next) {
      state.registrations = next;
      for (const listener of [...slotListeners]) listener();
    },
    setLocale(next) {
      state.active = next;
      for (const listener of [...localeListeners]) listener();
    },
  };
}

test("a panel label resolves strings, functions and language maps", () => {
  assert.equal(resolvePanelLabel("  Plugins  ", "zh"), "Plugins");
  assert.equal(resolvePanelLabel(() => "函数", "zh"), "函数");
  assert.equal(resolvePanelLabel({ zh: "插件", en: "Plugins" }, "zh"), "插件");
  assert.equal(resolvePanelLabel({ zh: "插件", en: "Plugins" }, "en"), "Plugins");
  assert.equal(
    resolvePanelLabel(() => {
      throw new Error("boom");
    }),
    "",
  );
});

test("panel entries keep the sidebar order and collapse duplicate ids", () => {
  const entries = collectPanelEntries(
    [
      { options: { id: "beta", label: "Beta", order: 20 } },
      { options: { id: "alpha", label: "Alpha", order: 10 } },
      { options: { id: "beta", label: "Beta again", order: 30 } },
      { options: { id: "", label: "No id" } },
      { options: { id: "bare" } },
    ],
    "zh",
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["bare", "alpha", "beta"],
  );
  assert.equal(entries[0].title, "bare");
  assert.equal(entries[0].idText, "");
  assert.equal(entries[1].title, "Alpha");
});

test("the panel store notifies only when the entries actually change", () => {
  let rows = [{ id: "a", title: "A", order: 0 }];
  const store = createPanelStore(() => rows);
  let notifications = 0;
  store.subscribe(() => (notifications += 1));
  store.refresh();
  assert.equal(notifications, 1);
  store.refresh();
  assert.equal(notifications, 1);
  rows = [
    { id: "a", title: "A", order: 0 },
    { id: "b", title: "B", order: 1 },
  ];
  store.refresh();
  assert.equal(notifications, 2);
  assert.equal(store.getSnapshot().length, 2);
});

test("the panel list filters, marks the active panel and opens the chosen one", () => {
  const harness = createHarness({
    registrations: [
      { options: { id: "plugins", label: "Plugins", order: 10 } },
      { options: { id: "schedule", label: "Schedule", order: 20 } },
    ],
  });
  const panel = panelOf({ activePanelId: "plugins" });
  const mounted = harness.spec.mount(panel);
  const matcher = mounted.matchers[0];
  assert.equal(matcher.match("x"), null);
  const state = matcher.match("#");
  const view = matcher.view(state, panel);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].badge, "current");
  assert.equal(view.rows[1].badge, undefined);
  assert.equal(view.placeholder, "placeholderPanels");

  view.rows[0].run();
  assert.equal(panel.closed, true);
  assert.deepEqual(harness.selected, []);

  view.rows[1].run();
  assert.deepEqual(harness.selected, ["schedule"]);
  assert.deepEqual(panel.closed, { restoreFocus: false });

  const filtered = matcher.view(matcher.match("#sched"), panel);
  assert.deepEqual(
    filtered.rows.map((row) => row.id ?? row.key),
    ["p:schedule"],
  );
});

test("empty deployment and empty filter read differently", () => {
  const harness = createHarness();
  const panel = panelOf();
  const matcher = harness.spec.mount(panel).matchers[0];
  assert.equal(matcher.view(matcher.match("#"), panel).emptyText, "emptyPanels");

  const withOne = createHarness({
    registrations: [{ options: { id: "plugins", label: "Plugins", order: 1 } }],
  });
  const oneMatcher = withOne.spec.mount(panelOf()).matchers[0];
  assert.equal(oneMatcher.view(oneMatcher.match("#zzz"), panel).emptyText, "emptyPanelMatches");
});

test("panel search highlights the label and only matches the id second", () => {
  const harness = createHarness({
    registrations: [
      { options: { id: "plugins", label: "插件", order: 0 } },
      { options: { id: "schedule", label: "自动化任务", order: 1 } },
    ],
  });
  const panel = panelOf();
  const matcher = harness.spec.mount(panel).matchers[0];
  const byLabel = matcher.view(matcher.match("#插件"), panel);
  assert.deepEqual(
    byLabel.rows.map((row) => row.key),
    ["p:plugins"],
  );
  assert.ok(byLabel.rows[0].positions.size > 0);
  const byId = matcher.view(matcher.match("#sched"), panel);
  assert.deepEqual(
    byId.rows.map((row) => row.key),
    ["p:schedule"],
  );
  assert.equal(byId.rows[0].positions.size, 0);
});

test("a registration or a locale switch refreshes an open list", () => {
  const harness = createHarness();
  let notifications = 0;
  const panel = panelOf({ notify: () => (notifications += 1) });
  const mounted = harness.spec.mount(panel);
  const matcher = mounted.matchers[0];
  assert.equal(matcher.view(matcher.match("#"), panel).rows.length, 0);

  harness.setRegistrations([{ options: { id: "plugins", label: { zh: "插件", en: "Plugins" } } }]);
  assert.equal(notifications, 1);
  assert.equal(matcher.view(matcher.match("#"), panel).rows[0].title, "插件");

  harness.setLocale("en");
  assert.equal(notifications, 2);
  assert.equal(matcher.view(matcher.match("#"), panel).rows[0].title, "Plugins");
});

test("a failed panel selection keeps the overlay and reports the error", () => {
  const harness = createHarness({
    registrations: [{ options: { id: "plugins", label: "Plugins", order: 1 } }],
  });
  harness.api.services.layout.selectPanel = () => {
    throw new Error("gone");
  };
  const panel = panelOf();
  const matcher = harness.spec.mount(panel).matchers[0];
  const view = matcher.view(matcher.match("#"), panel);
  view.rows[0].run();
  assert.equal(panel.error, "panelOpenFailed");
  assert.equal(panel.closed, undefined);
});
