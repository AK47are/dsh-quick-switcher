import assert from "node:assert/strict";
import test from "node:test";
import archive from "../src/modules/archive/client.js";

const t = (key, params) => (params === undefined ? key : `${key}:${params.count}`);

function createStore() {
  const listeners = new Set();
  let snapshot = null;
  return {
    getSnapshot: () => snapshot,
    publish(value) {
      snapshot = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function panelOf() {
  return {
    now: 10_000,
    notifications: 0,
    notify() {
      this.notifications += 1;
    },
    close(options) {
      this.closed = options ?? true;
    },
    setError(text) {
      this.error = text;
    },
  };
}

function entryOf(overrides = {}) {
  return {
    id: "s5",
    idKey: "s5",
    shortId: "s5",
    title: "Archived",
    titleLower: "archived",
    workspace: "Work",
    path: "/work",
    metaLower: "work /work",
    updatedAt: 5000,
    lastAccessAt: 0,
    recentAt: 5000,
    status: {
      state: "idle",
      kind: "idle",
      labelKey: "statusIdle",
      compactKey: null,
      subagentCount: 0,
    },
    current: false,
    pinned: false,
    ...overrides,
  };
}

/**
 * A row builder that fails loudly when the archive module forgets to replace
 * the session row's own open, because opening an archived session is inert.
 */
function rowForOf() {
  return (entry, panel, options) => ({
    key: `s:${entry.id}`,
    title: entry.title,
    positions: options.positions,
    meta: [{ text: entry.workspace, className: "dqs-workspace" }],
    status: null,
    badge: null,
    run() {
      throw new Error("the archive module must replace the session row run");
    },
  });
}

function createHarness({ entries = [entryOf()], unarchive, open } = {}) {
  const store = createStore();
  const calls = { unarchive: [], open: [] };
  const uiWorkspace = {
    async unarchiveSession(id) {
      calls.unarchive.push(id);
      return unarchive === undefined ? undefined : unarchive(id);
    },
    openSession(id) {
      calls.open.push(id);
      return open === undefined ? undefined : open(id);
    },
  };
  const api = {
    id: "archive",
    t,
    services: { uiWorkspace },
    shared: { store: () => store },
    get: () => undefined,
    settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
    log: {},
  };
  const spec = archive.setup(api);
  const panel = panelOf();
  const mounted = spec.mount(panel);
  store.publish({ archivedEntries: entries, rowFor: rowForOf() });
  return { api, spec, panel, mounted, store, calls, matcher: mounted.matchers[0] };
}

test("only the tilde prefixes claim the query", () => {
  const harness = createHarness();
  assert.equal(harness.matcher.match("x"), null);
  assert.deepEqual(harness.matcher.match("~"), { filter: "" });
  assert.deepEqual(harness.matcher.match("～"), { filter: "" });
  assert.deepEqual(harness.matcher.match("~fix"), { filter: "fix" });
});

test("the view lists archived rows and separates the two empty states", () => {
  const harness = createHarness();
  const view = harness.matcher.view({ filter: "" }, harness.panel);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].key, "s:s5");
  assert.equal(view.rows[0].title, "Archived");
  assert.equal(view.rows[0].status, null);
  assert.equal(view.rows[0].badge, null);
  assert.equal(view.emptyText, null);
  assert.equal(view.note, null);
  assert.equal(view.count, "count:1");
  assert.deepEqual(
    view.hints.map((hint) => hint.keys[0]),
    ["Shift+Enter", "Esc"],
  );

  const filtered = harness.matcher.view({ filter: "zzz" }, harness.panel);
  assert.equal(filtered.rows.length, 0);
  assert.equal(filtered.emptyText, "emptyFiltered");
  assert.equal(filtered.note, null);

  harness.store.publish({ archivedEntries: [], rowFor: rowForOf() });
  const empty = harness.matcher.view({ filter: "" }, harness.panel);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.emptyText, null);
  assert.equal(empty.note, "empty");
});

test("a snapshot without a row builder renders nothing", () => {
  const harness = createHarness();
  harness.store.publish({ archivedEntries: [entryOf()], rowFor: null });
  const view = harness.matcher.view({ filter: "" }, harness.panel);
  assert.deepEqual(view.rows, []);
  assert.equal(view.note, null);
});

test("Enter unarchives before opening and closes the panel", async () => {
  const order = [];
  const harness = createHarness({
    unarchive: (id) => order.push(["unarchive", id]),
    open: (id) => order.push(["open", id]),
  });
  const row = harness.matcher.view({ filter: "" }, harness.panel).rows[0];
  await row.run();
  assert.deepEqual(order, [
    ["unarchive", "s5"],
    ["open", "s5"],
  ]);
  assert.deepEqual(harness.panel.closed, { restoreFocus: false });
});

test("Shift+Enter only unarchives and keeps the panel open", async () => {
  const harness = createHarness();
  const row = harness.matcher.view({ filter: "" }, harness.panel).rows[0];
  await row.shiftRun();
  assert.deepEqual(harness.calls.unarchive, ["s5"]);
  assert.deepEqual(harness.calls.open, []);
  assert.equal(harness.panel.closed, undefined);
});

test("a failed unarchive reports the failure and does not open", async () => {
  const harness = createHarness({
    unarchive: () => {
      throw new Error("workspace/session-active");
    },
  });
  const row = harness.matcher.view({ filter: "" }, harness.panel).rows[0];
  await row.run();
  assert.equal(harness.panel.error, "unarchiveFailed");
  assert.deepEqual(harness.calls.open, []);
  assert.equal(harness.panel.closed, undefined);
});

test("a failed open reports the failure and keeps the panel open", async () => {
  const harness = createHarness({
    open: () => {
      throw new Error("open failed");
    },
  });
  const row = harness.matcher.view({ filter: "" }, harness.panel).rows[0];
  await row.run();
  assert.equal(harness.panel.error, "openFailed");
  assert.deepEqual(harness.calls.unarchive, ["s5"]);
  assert.equal(harness.panel.closed, undefined);
});

test("a repeated Enter while the first restore is in flight is ignored", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({ unarchive: () => gate });
  const row = harness.matcher.view({ filter: "" }, harness.panel).rows[0];
  const first = row.run();
  const second = row.run();
  await Promise.resolve();
  assert.deepEqual(harness.calls.unarchive, ["s5"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(harness.calls.open, ["s5"]);
});

test("the module declares the sessions dependency and its own entry", () => {
  const harness = createHarness();
  assert.deepEqual(harness.spec.dependencies, ["sessions"]);
  assert.equal(harness.spec.order, 15);
  assert.equal(harness.spec.entry.seed, "~");
  assert.equal(harness.matcher.id, "archive");
  assert.equal(harness.matcher.match(harness.spec.entry.seed).filter, "");
  assert.equal(harness.panel.notifications, 1);
});
