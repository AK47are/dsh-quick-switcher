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

test("the workspace list filters, remembers the id and enters the workspace-path mode on shift", () => {
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
    options: { selectedKey: "c:w1" },
  });

  // Shift now seeds the parent directory of the highlighted workspace; the
  // directory drill and the registration itself belong to the "=" mode.
  view.rows[0].shiftRun();
  assert.equal(harness.panel.query.query, "=/");
  assert.deepEqual(harness.calls.started, []);
  assert.equal(harness.panel.closed, undefined);
});

test("Tab completes the highlighted title without opening the scope", () => {
  const harness = createHarness();
  harness.publish();
  const view = harness.matcher.view(harness.matcher.match("+"), harness.panel);
  assert.deepEqual(view.hints[1], { keys: ["Tab"], label: "hintCompleteTitle" });

  assert.equal(view.keydown({ key: "Tab" }, harness.panel, view.rows[0]), true);
  assert.deepEqual(harness.panel.query, {
    query: "+Work",
    options: { selectedKey: "w:w1" },
  });
  // No trailing space means the token is not a scope yet.
  assert.deepEqual(harness.matcher.match("+Work"), { mode: "list", filter: "Work" });

  assert.equal(view.keydown({ key: "Tab" }, harness.panel, view.rows[1]), true);
  assert.deepEqual(harness.panel.query, {
    query: "+Other",
    options: { selectedKey: "w:w2" },
  });

  harness.panel.query = undefined;
  assert.equal(view.keydown({ key: "Tab", shiftKey: true }, harness.panel, view.rows[0]), false);
  assert.equal(harness.panel.query, undefined);
});

test("a completed title stays in the list when a shorter title forms a scope", () => {
  const harness = createHarness();
  const workspaceRows = [
    {
      workspaceId: "w1",
      title: "Work",
      path: "/a",
      titleLower: "work",
      metaLower: "work /a",
      sessions: [],
      count: 0,
      updatedAt: 1,
    },
    {
      workspaceId: "w2",
      title: "Work Shop",
      path: "/b",
      titleLower: "work shop",
      metaLower: "work shop /b",
      sessions: [],
      count: 0,
      updatedAt: 2,
    },
  ];
  harness.shared.publish({ entries: [], workspaceRows, rowFor: null, currentId: null });
  const view = harness.matcher.view(harness.matcher.match("+"), harness.panel);
  const target = view.rows.find((row) => row.key === "w:w2");
  assert.equal(view.keydown({ key: "Tab" }, harness.panel, target), true);
  assert.deepEqual(harness.panel.query, {
    query: "+Work Shop",
    options: { selectedKey: "w:w2" },
  });
  assert.deepEqual(harness.matcher.match("+Work Shop"), {
    mode: "list",
    filter: "Work Shop",
  });

  target.run();
  assert.deepEqual(harness.panel.query, {
    query: "+Work Shop ",
    options: { selectedKey: "c:w2" },
  });
  const entered = harness.matcher.match("+Work Shop ");
  assert.equal(entered.mode, "scope");
  assert.equal(entered.workspace.workspaceId, "w2");

  // The completion guard lasts for one query; typing the same text by hand
  // still follows the scope grammar.
  const manual = harness.matcher.match("+Work Shop");
  assert.equal(manual.mode, "scope");
  assert.equal(manual.workspace.workspaceId, "w1");
  assert.equal(manual.filter, "Shop");
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
  assert.deepEqual(harness.panel.query.options, { selectedKey: "c:w2" });

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
  const scope = harness.matcher.match("+Work ");
  const scopeView = harness.matcher.view(scope, harness.panel);
  scopeView.rows[0].run();
  assert.equal(harness.panel.error, "createFailed");
  assert.equal(harness.panel.closed, undefined);
});

test("the longest matching title wins when titles overlap", () => {
  const harness = createHarness();
  const entries = [entryOf("q1e", "One"), entryOf("q2e", "Two")];
  harness.shared.publish({
    entries,
    currentId: null,
    workspaceRows: [
      {
        workspaceId: "q1",
        title: "dsh",
        path: "/p/dsh",
        sessions: [entries[0]],
        count: 1,
        updatedAt: 10,
      },
      {
        workspaceId: "q2",
        title: "dsh quick",
        path: "/p/dsh-quick",
        sessions: [entries[1]],
        count: 1,
        updatedAt: 20,
      },
    ],
    rowFor: () => ({ key: "s:q1e", title: "One", run() {} }),
  });
  const longest = harness.matcher.match("+dsh quick anything");
  assert.equal(longest.mode, "scope");
  assert.equal(longest.workspace.workspaceId, "q2");
  assert.equal(longest.filter, "anything");

  const shorter = harness.matcher.match("+dsh quickfix");
  assert.equal(shorter.mode, "scope");
  assert.equal(shorter.workspace.workspaceId, "q1");
  assert.equal(shorter.filter, "quickfix");
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
