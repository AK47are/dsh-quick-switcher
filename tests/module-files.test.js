import assert from "node:assert/strict";
import test from "node:test";
import files from "../src/modules/files/client.js";

const t = (key, params) => {
  if (params === undefined) return key;
  if (Object.hasOwn(params, "reason")) return `${key}:${params.reason}`;
  if (Object.hasOwn(params, "count")) return `${key}:${params.count}`;
  return key;
};

function panelOf(overrides = {}) {
  return {
    currentSessionId: "s1",
    notifications: 0,
    notify() {
      this.notifications += 1;
    },
    close(options) {
      this.closed = options ?? true;
    },
    setQuery(query, options) {
      this.query = { query, options };
    },
    setError(text) {
      this.error = text;
    },
    ...overrides,
  };
}

function createHarness({ references, sidebarRight } = {}) {
  const api = {
    id: "files",
    t,
    services: {},
    shared: { store: () => ({ getSnapshot: () => null, publish() {}, subscribe: () => () => {} }) },
    get(name) {
      if (name === "remote.fileReferences") return references;
      if (name === "sidebarRight") return sidebarRight;
      return undefined;
    },
    effect: (callback) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    settings: { get: () => undefined, set() {}, subscribe: () => () => {} },
    log: {},
  };
  const spec = files.setup(api);
  const panel = panelOf();
  const mounted = spec.mount(panel);
  const matcher = mounted.matchers[0];
  return { api, spec, panel, mounted, matcher };
}

function candidates() {
  return [
    { path: "src", kind: "directory" },
    { path: "src/app.js", kind: "file" },
  ];
}

test("only the at prefix claims the query and no session explains itself", () => {
  const harness = createHarness();
  assert.equal(harness.matcher.match("x", harness.panel), null);
  const state = harness.matcher.match("@", panelOf({ currentSessionId: null }));
  assert.deepEqual(state, { filter: "", sessionId: null });
  const view = harness.matcher.view(state, harness.panel);
  assert.deepEqual(view.rows, []);
  assert.equal(view.emptyText, "filesNoSession");
});

test("a settled search renders files and directories with their meta", async () => {
  const references = {
    calls: [],
    async list(sessionId, query, signal) {
      this.calls.push([sessionId, query]);
      assert.ok(signal instanceof AbortSignal);
      return { ok: true, value: candidates() };
    },
  };
  const harness = createHarness({ references });
  const state = harness.matcher.match("@", harness.panel);
  const loading = harness.matcher.view(state, harness.panel);
  assert.equal(loading.emptyText, "filesLoading");
  loading.load();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(harness.panel.notifications, 1);
  const view = harness.matcher.view(state, harness.panel);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].key, "d:src");
  assert.equal(view.rows[0].title, "src/");
  assert.equal(view.rows[0].meta[0].text, "./");
  assert.equal(view.rows[1].key, "f:src/app.js");
  assert.equal(view.rows[1].title, "app.js");
  assert.equal(view.rows[1].meta[0].text, "src");
  assert.equal(view.count, "countFiles:2");
  assert.equal(view.emptyText, null);
  assert.deepEqual(references.calls, [["s1", ""]]);
});

test("a directory row continues the query and a file row opens the preview", async () => {
  const opened = [];
  const references = { async list() {} };
  const harness = createHarness({
    references,
    sidebarRight: { openResource: (address) => opened.push(address) },
  });
  references.list = async () => ({ ok: true, value: candidates() });
  const state = harness.matcher.match("@", harness.panel);
  harness.matcher.view(state, harness.panel).load();
  await new Promise((resolve) => setTimeout(resolve, 180));
  const view = harness.matcher.view(state, harness.panel);

  view.rows[0].run();
  assert.equal(harness.panel.query.query, "@src/");

  view.rows[1].run();
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^dsh-resource:\/\/file\/session\/s1\/src\/app\.js$/u);
  assert.equal(harness.panel.closed, true);

  view.rows[1].shiftRun();
  assert.equal(opened.length, 2);
  assert.deepEqual(harness.panel.closed, { restoreFocus: false });
});

test("an open failure keeps the overlay and reports the file error", async () => {
  const harness = createHarness({
    references: { async list() {} },
  });
  harness.api.get = (name) => {
    if (name === "remote.fileReferences") {
      return { list: async () => ({ ok: true, value: candidates() }) };
    }
    return undefined;
  };
  const state = harness.matcher.match("@", harness.panel);
  harness.matcher.view(state, harness.panel).load();
  await new Promise((resolve) => setTimeout(resolve, 180));
  const view = harness.matcher.view(state, harness.panel);
  view.rows[1].run();
  assert.equal(harness.panel.error, "fileOpenFailed");
  assert.equal(harness.panel.closed, undefined);
});

test("a Host failure is shown with its reason", async () => {
  const harness = createHarness({
    references: {
      async list() {
        return { ok: false, error: { code: "index", message: "not ready" } };
      },
    },
  });
  const state = harness.matcher.match("@", harness.panel);
  harness.matcher.view(state, harness.panel).load();
  await new Promise((resolve) => setTimeout(resolve, 180));
  const view = harness.matcher.view(state, harness.panel);
  assert.equal(view.emptyText, "filesFailedWithReason:index: not ready");
});

test("a missing file service degrades to the error state, not a crash", async () => {
  const harness = createHarness();
  const state = harness.matcher.match("@", harness.panel);
  harness.matcher.view(state, harness.panel).load();
  assert.equal(harness.panel.notifications, 1);
  const view = harness.matcher.view(state, harness.panel);
  assert.equal(view.emptyText, "filesFailedWithReason:search");
});

test("closing the panel aborts the pending search", () => {
  const references = {
    list() {
      return new Promise(() => {});
    },
  };
  const harness = createHarness({ references });
  const state = harness.matcher.match("@", harness.panel);
  harness.matcher.view(state, harness.panel).load();
  harness.mounted.dispose();
  assert.equal(harness.panel.notifications, 0);
});

