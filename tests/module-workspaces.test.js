import assert from "node:assert/strict";
import test from "node:test";
import { createSharedStores } from "../src/core/shared-store.js";
import workspaces from "../src/modules/workspaces/client.js";

const t = (key, params) =>
  params !== undefined && Object.hasOwn(params, "count") ? `${key}:${params.count}` : key;

function entryOf(id, title) {
  return { id, title, titleLower: title.toLocaleLowerCase(), metaLower: title.toLocaleLowerCase() };
}

function panelOf(overrides = {}) {
  return {
    currentSessionId: "s1",
    activePanelId: null,
    close(options) {
      this.closed = options ?? true;
    },
    setQuery(query, options) {
      this.query = { query, options };
    },
    setError(text) {
      this.error = text;
    },
    notify() {},
    ...overrides,
  };
}

function createHarness() {
  const bus = createSharedStores();
  const shared = bus.store("session-data");
  const calls = { started: [], rows: [], errors: [] };
  const api = {
    id: "workspaces",
    t,
    services: {
      uiWorkspace: {
        startSession(workspaceId) {
          calls.started.push(workspaceId);
        },
      },
    },
    shared: bus,
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
    log: {},
  };
  const spec = workspaces.setup(api);
  const panel = panelOf();
  const mounted = spec.mount(panel);
  const matcher = mounted.matchers[0];

  function publish(overrides = {}) {
    const entries = [entryOf("s1", "Alpha"), entryOf("s2", "Beta")];
    const workspaceRows = [
      {
        workspaceId: "w1",
        title: "Work",
        path: "/work",
        titleLower: "work",
        metaLower: "work /work",
        updatedAt: 10,
        sessions: entries,
        count: 2,
      },
      {
        workspaceId: "w2",
        title: "Other",
        path: "/other",
        titleLower: "other",
        metaLower: "other /other",
        updatedAt: 0,
        sessions: [],
        count: 0,
      },
    ];
    shared.publish({
      entries,
      currentId: "s1",
      workspaceRows,
      rowFor(entry, _panel, options) {
        return {
          key: `s:${entry.id}`,
          title: entry.title,
          positions: options?.positions ?? null,
          run() {
            calls.rows.push(entry.id);
          },
        };
      },
      ...overrides,
    });
    return { entries, workspaceRows };
  }

  return { api, spec, panel, mounted, matcher, shared, calls, publish };
}

test("only the plus prefix claims the query", () => {
  const harness = createHarness();
  harness.publish();
  assert.equal(harness.matcher.match(""), null);
  assert.equal(harness.matcher.match(">"), null);
  const state = harness.matcher.match("+");
  assert.deepEqual(state, { mode: "list", filter: "" });
});

test("the workspace list filters, remembers the id and starts on shift", () => {
  const harness = createHarness();
  harness.publish();
  const state = harness.matcher.match("+");
  const view = harness.matcher.view(state, harness.panel);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].key, "w:w1");
  assert.equal(view.rows[0].trailing, "count:2");
  assert.equal(view.placeholder, "placeholderWorkspaces");
  assert.equal(view.count, "countWorkspaces:2");

  view.rows[0].run();
  assert.deepEqual(harness.panel.query, {
    query: "+Work ",
    options: { selectedKey: "s:s1" },
  });

  view.rows[0].shiftRun();
  assert.deepEqual(harness.calls.started, ["w1"]);
  assert.deepEqual(harness.panel.closed, { restoreFocus: false });
});

test("entering a workspace lists its sessions and a create row", () => {
  const harness = createHarness();
  harness.publish();
  const state = harness.matcher.match("+wo");
  assert.equal(state.mode, "list");
  harness.panel.query = { query: "+Work ", options: {} };
  const scope = harness.matcher.match("+Work ");
  assert.equal(scope.mode, "scope");
  assert.equal(scope.workspace.workspaceId, "w1");
  assert.equal(scope.filter, "");
  const view = harness.matcher.view(scope, harness.panel);
  assert.equal(view.rows.length, 3);
  assert.equal(view.rows[0].key, "c:w1");
  assert.equal(view.rows[0].action, true);
  assert.equal(view.rows[0].title, "newSession");
  assert.equal(view.rows[1].key, "s:s1");
  assert.equal(view.count, "count:2");

  view.rows[0].run();
  assert.deepEqual(harness.calls.started, ["w1"]);
  assert.deepEqual(harness.panel.closed, { restoreFocus: false });
});

test("the scope filter narrows the session rows and keeps the title token", () => {
  const harness = createHarness();
  harness.publish();
  const scope = harness.matcher.match("+Work bet");
  assert.equal(scope.filter, "bet");
  const view = harness.matcher.view(scope, harness.panel);
  assert.deepEqual(
    view.rows.slice(1).map((row) => row.key),
    ["s:s2"],
  );
});

test("a pinned workspace keeps its id even when two titles are equal", () => {
  const harness = createHarness();
  const entries = [entryOf("s1", "Alpha")];
  const sharedRows = [
    { workspaceId: "w1", title: "Same", path: "/a", sessions: entries, count: 1, updatedAt: 1 },
    { workspaceId: "w2", title: "Same", path: "/b", sessions: entries, count: 1, updatedAt: 0 },
  ];
  harness.shared.publish({
    entries,
    currentId: "s1",
    workspaceRows: sharedRows,
    rowFor: () => ({ key: "s:s1", title: "Alpha", run() {} }),
  });
  const list = harness.matcher.match("+");
  const view = harness.matcher.view(list, harness.panel);
  view.rows[1].run();
  assert.equal(harness.panel.query.query, "+Same ");
  assert.deepEqual(harness.panel.query.options, { selectedKey: "s:s1" });

  const pinned = harness.matcher.match("+Same ");
  assert.equal(pinned.mode, "scope");
  assert.equal(pinned.workspace.workspaceId, "w2");

  const reset = harness.matcher.match("+");
  assert.equal(reset.mode, "list");
  const byTitle = harness.matcher.match("+Same ");
  assert.equal(byTitle.workspace.workspaceId, "w1");
});

test("a missing session row builder cannot happen before the list is published", () => {
  const harness = createHarness();
  const state = harness.matcher.match("+");
  const view = harness.matcher.view(state, harness.panel);
  assert.deepEqual(view.rows, []);
  assert.equal(view.emptyText, "emptyWorkspaces");
});

test("the empty workspace and empty filter notes read differently", () => {
  const harness = createHarness();
  harness.publish();
  const scope = harness.matcher.match("+Other ");
  const view = harness.matcher.view(scope, harness.panel);
  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["c:w2"],
  );
  assert.equal(view.note, "emptyWorkspaceSessions");
  assert.equal(view.emptyText, null);

  const filtered = harness.matcher.match("+Work zzz");
  const filteredView = harness.matcher.view(filtered, harness.panel);
  assert.equal(filteredView.rows.length, 1);
  assert.equal(filteredView.note, "empty");
});

test("a start failure keeps the panel open and reports the error", () => {
  const harness = createHarness();
  harness.publish();
  harness.api.services.uiWorkspace.startSession = () => {
    throw new Error("no");
  };
  const list = harness.matcher.match("+");
  const view = harness.matcher.view(list, harness.panel);
  view.rows[0].shiftRun();
  assert.equal(harness.panel.error, "createFailed");
  assert.equal(harness.panel.closed, undefined);

  const scope = harness.matcher.match("+Work ");
  const scopeView = harness.matcher.view(scope, harness.panel);
  scopeView.rows[0].run();
  assert.equal(harness.panel.error, "createFailed");
});

test("a published snapshot asks the open panel for one more render", () => {
  const harness = createHarness();
  let notifications = 0;
  const mounted = harness.spec.mount(panelOf({ notify: () => (notifications += 1) }));
  harness.publish();
  assert.equal(notifications, 1);
  mounted.dispose();
  harness.publish();
  assert.equal(notifications, 1);
});
