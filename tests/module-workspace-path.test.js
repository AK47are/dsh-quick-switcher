import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspacePathRuntime } from "../src/modules/workspace-path/logic.js";
import { parseCreateQuery } from "../src/modules/workspace-path/path.js";
import { LIST_PATH, MKDIR_PATH } from "../src/modules/workspace-path/shared.js";

const WIN = "win32";
const POSIX = "posix";

function translate(key, params) {
  if (params !== null && typeof params === "object") {
    if (Object.hasOwn(params, "count")) return `${key}:${params.count}`;
    if (Object.hasOwn(params, "title")) return `${key}:${params.title}`;
    if (Object.hasOwn(params, "reason")) return `${key}:${params.reason}`;
  }
  return key;
}

function responseOf(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

/** A transport that answers list and mkdir calls from the supplied tables. */
function createTransport({ list, mkdir } = {}) {
  const calls = [];
  const request = async (input, init = {}) => {
    calls.push({ input, init });
    const url = new URL(input, "http://localhost");
    if (url.pathname === MKDIR_PATH) {
      const body = JSON.parse(init.body ?? "{}");
      return responseOf(mkdir === undefined ? { ok: true, path: body.path } : mkdir(body));
    }
    const target = url.searchParams.get("path") ?? "";
    return responseOf(list === undefined ? { ok: false, code: "missing" } : list(target));
  };
  return { calls, request };
}

function workspaceServiceOf({ items = [], created, createError } = {}) {
  return {
    list: {
      getSnapshot: () => ({ items }),
      subscribe: () => () => {},
    },
    create: async (input) => {
      created.push(input.path);
      if (createError !== undefined) throw createError;
      const hit = items.find((item) => item.path === input.path);
      return { workspaceId: hit?.workspaceId ?? "w-new", path: input.path };
    },
  };
}

function createHarness({ startDir = null, items = [], transport, createError } = {}) {
  const created = [];
  const started = [];
  const services = { uiWorkspace: { startSession: (id) => started.push(id) } };
  const workspaces = workspaceServiceOf({ items, created, createError });
  const api = {
    id: "workspace-path",
    t: translate,
    get(name) {
      return name === "workspaces" ? workspaces : undefined;
    },
    services,
    settings: {},
    shared: {},
    effect: () => () => {},
    log: {},
  };
  const panel = {
    currentSessionId: "s1",
    query: "",
    error: null,
    notifications: 0,
    closed: undefined,
    setQuery(query) {
      this.query = query;
    },
    setError(error) {
      this.error = error;
    },
    notify() {
      this.notifications += 1;
    },
    close(options) {
      this.closed = options ?? true;
    },
  };
  const runtime = createWorkspacePathRuntime({
    api,
    panel,
    request: transport.request,
    startDir,
    style: startDir !== null && startDir.includes("\\") ? WIN : POSIX,
  });
  return { api, panel, runtime, transport, created, started };
}

function wait(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a typed path splits into the directory to list and the segment to filter", () => {
  const win = { startDir: "C:\\Users\\ASUS1", style: WIN };
  assert.deepEqual(parseCreateQuery("", win), {
    kind: "fragment",
    style: WIN,
    absolute: true,
    directory: "C:\\Users\\ASUS1",
    fragment: "",
    target: null,
  });
  assert.deepEqual(parseCreateQuery("C:\\Users", win), {
    kind: "fragment",
    style: WIN,
    absolute: true,
    directory: "C:\\",
    fragment: "Users",
    target: null,
  });
  assert.deepEqual(parseCreateQuery("C:\\Users\\", win), {
    kind: "intent",
    style: WIN,
    absolute: true,
    directory: "C:\\Users",
    fragment: "",
    target: "C:\\Users",
  });
  assert.deepEqual(parseCreateQuery("C:", win), {
    kind: "intent",
    style: WIN,
    absolute: true,
    directory: "C:\\",
    fragment: "",
    target: "C:\\",
  });
  assert.equal(parseCreateQuery("proj", win).directory, "C:\\Users\\ASUS1\\");
  assert.equal(parseCreateQuery("proj", win).fragment, "proj");
  assert.equal(parseCreateQuery("new\\", win).kind, "intent");
  assert.equal(parseCreateQuery("new\\", win).directory, "C:\\Users\\ASUS1\\new");
  assert.equal(parseCreateQuery("\\foo", win).directory, "C:\\");
  assert.equal(parseCreateQuery("\\foo", win).fragment, "foo");
  assert.equal(parseCreateQuery("\\\\server\\share", win).kind, "intent");
  assert.equal(parseCreateQuery("\\\\server\\share\\proj\\", win).directory, "\\\\server\\share\\proj");

  const posix = { startDir: "/home/user", style: POSIX };
  assert.equal(parseCreateQuery("/home/user/", posix).kind, "intent");
  assert.equal(parseCreateQuery("/home/user/", posix).directory, "/home/user");
  assert.equal(parseCreateQuery("/", posix).directory, "/");
  assert.equal(parseCreateQuery("workspace", posix).directory, "/home/user/");
  assert.deepEqual(parseCreateQuery("", { style: POSIX }), {
    kind: "none",
    reason: "missing-start",
  });
  assert.deepEqual(parseCreateQuery("home", { style: POSIX }), {
    kind: "none",
    reason: "not-absolute",
    fragment: "home",
  });
});

test("a seeded directory lists its subdirectories and keeps a commit target", async () => {
  const transport = createTransport({
    list: (target) =>
      target === "C:\\Users\\ASUS1\\projects"
        ? {
            ok: true,
            path: target,
            platform: WIN,
            entries: [
              { name: "alpha", path: "C:\\Users\\ASUS1\\projects\\alpha" },
              { name: ".git", path: "C:\\Users\\ASUS1\\projects\\.git" },
            ],
          }
        : { ok: false, code: "missing" },
  });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });

  const loading = harness.runtime.view("C:\\Users\\ASUS1\\projects\\");
  assert.equal(loading.emptyText, "workspacePathLoading");
  loading.load();
  await wait();

  const ready = harness.runtime.view("C:\\Users\\ASUS1\\projects\\");
  assert.equal(ready.rows.length, 2);
  assert.equal(ready.rows[0].target, true);
  assert.equal(ready.rows[0].title, "workspacePathHere");
  assert.equal(ready.rows[1].title, "alpha/");
  assert.equal(ready.rows[1].meta[0].text, "C:\\Users\\ASUS1\\projects\\alpha");
  assert.equal(ready.count, "workspacePathCount:1");
  assert.equal(ready.note, null);

  // Tab on the target is consumed without moving the query; on a child it
  // rewrites the query to that child plus a separator.
  assert.equal(harness.runtime.view("C:\\Users\\ASUS1\\projects\\").keydown(
    { key: "Tab" },
    harness.panel,
    ready.rows[0],
  ), true);
  assert.equal(harness.panel.query, "");
  assert.equal(
    ready.keydown({ key: "Tab" }, harness.panel, ready.rows[1]),
    true,
  );
  assert.equal(harness.panel.query, "=C:\\Users\\ASUS1\\projects\\alpha\\");
  assert.equal(
    ready.keydown({ key: "Tab", shiftKey: true }, harness.panel, ready.rows[1]),
    false,
  );
  assert.equal(ready.keydown({ key: "Enter" }, harness.panel, ready.rows[1]), false);

  await ready.rows[1].run();
  assert.deepEqual(harness.created, ["C:\\Users\\ASUS1\\projects\\alpha"]);
  assert.deepEqual(harness.started, ["w-new"]);
  assert.deepEqual(harness.panel.closed, { restoreFocus: false });
});

test("an existing workspace is labelled and opened instead of recreated", async () => {
  const items = [
    {
      workspaceId: "w1",
      title: "Projects",
      path: "C:\\Users\\ASUS1\\projects",
      sessionIds: ["s1"],
    },
  ];
  const transport = createTransport({
    list: () => ({
      ok: true,
      path: "C:\\Users\\ASUS1\\projects",
      platform: WIN,
      entries: [],
    }),
  });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", items, transport });
  harness.runtime.view("C:\\Users\\ASUS1\\projects\\").load();
  await wait();

  const view = harness.runtime.view("C:\\Users\\ASUS1\\projects\\");
  assert.equal(view.rows[0].title, "workspacePathExisting:Projects");

  await view.rows[0].run();
  assert.deepEqual(harness.created, ["C:\\Users\\ASUS1\\projects"]);
  assert.deepEqual(harness.started, ["w1"]);
});

test("the typed segment filters a cached listing without refetching", async () => {
  const transport = createTransport({
    list: () => ({
      ok: true,
      path: "C:\\Users\\ASUS1\\projects",
      platform: WIN,
      entries: [
        { name: "alpha", path: "C:\\Users\\ASUS1\\projects\\alpha" },
        { name: "my-project", path: "C:\\Users\\ASUS1\\projects\\my-project" },
        { name: ".git", path: "C:\\Users\\ASUS1\\projects\\.git" },
      ],
    }),
  });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });
  harness.runtime.view("C:\\Users\\ASUS1\\projects\\").load();
  await wait();
  assert.equal(transport.calls.length, 1);

  const byPrefix = harness.runtime.view("C:\\Users\\ASUS1\\projects\\my");
  assert.deepEqual(
    byPrefix.rows.map((row) => row.title),
    ["my-project/"],
  );
  const byFuzzy = harness.runtime.view("C:\\Users\\ASUS1\\projects\\alp");
  assert.deepEqual(
    byFuzzy.rows.map((row) => row.title),
    ["alpha/"],
  );
  const hidden = harness.runtime.view("C:\\Users\\ASUS1\\projects\\.g");
  assert.deepEqual(
    hidden.rows.map((row) => row.title),
    [".git/"],
  );
  const empty = harness.runtime.view("C:\\Users\\ASUS1\\projects\\zzz");
  assert.equal(empty.emptyText, "workspacePathNoMatch");
  assert.equal(empty.note, "workspacePathSeparatorHint");
  // Typing inside the segment never changes the directory, so the cache holds.
  assert.equal(transport.calls.length, 1);
});

test("a missing directory offers the mkdir row and creates the tree first", async () => {
  const transport = createTransport({
    list: () => ({ ok: false, code: "missing" }),
  });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });

  const loading = harness.runtime.view("C:\\Users\\ASUS1\\new\\deep\\");
  assert.equal(loading.emptyText, "workspacePathLoading");
  loading.load();
  await wait();

  const view = harness.runtime.view("C:\\Users\\ASUS1\\new\\deep\\");
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].title, "workspacePathCreateDirectory");
  assert.equal(view.note, "workspacePathWillCreate");

  await view.rows[0].run();
  const mkdir = transport.calls.find((call) => call.input === MKDIR_PATH);
  assert.ok(mkdir !== undefined);
  assert.deepEqual(JSON.parse(mkdir.init.body), { path: "C:\\Users\\ASUS1\\new\\deep" });
  assert.deepEqual(harness.created, ["C:\\Users\\ASUS1\\new\\deep"]);
  assert.deepEqual(harness.started, ["w-new"]);
});

test("a missing drive root is reported instead of being created", async () => {
  const transport = createTransport({ list: () => ({ ok: false, code: "missing" }) });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });
  harness.runtime.view("Z:\\").load();
  await wait();

  const view = harness.runtime.view("Z:\\");
  assert.deepEqual(view.rows, []);
  assert.equal(view.emptyText, "workspacePathRootMissing");
  assert.equal(
    transport.calls.some((call) => call.input === MKDIR_PATH),
    false,
  );
});

test("a listing that is not a directory explains itself", async () => {
  const transport = createTransport({ list: () => ({ ok: false, code: "not-directory" }) });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });
  harness.runtime.view("C:\\Users\\ASUS1\\readme.txt\\").load();
  await wait();

  const view = harness.runtime.view("C:\\Users\\ASUS1\\readme.txt\\");
  assert.deepEqual(view.rows, []);
  assert.equal(view.emptyText, "workspacePathNotDirectory");
});

test("a bare equals sign seeds the current workspace, or home without one", async () => {
  const workspaceHarness = createHarness({
    startDir: "C:\\Users\\ASUS1",
    transport: createTransport({}),
  });
  workspaceHarness.runtime.view("").load();
  assert.equal(workspaceHarness.panel.query, "=C:\\Users\\ASUS1\\");

  const transport = createTransport({
    list: (target) =>
      target === ""
        ? {
            ok: true,
            path: "C:\\Users\\ASUS1",
            home: "C:\\Users\\ASUS1",
            platform: WIN,
            entries: [],
          }
        : { ok: false, code: "missing" },
  });
  const homeHarness = createHarness({ startDir: null, transport });
  homeHarness.runtime.view("").load();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(homeHarness.panel.query, "=C:\\Users\\ASUS1\\");
});

test("a cancelled or failing registration keeps the panel open", async () => {
  const transport = createTransport({
    list: (target) =>
      target === "C:\\Users\\ASUS1"
        ? { ok: true, path: target, platform: WIN, entries: [] }
        : { ok: false, code: "missing" },
    mkdir: () => ({ ok: false, code: "denied", message: "permission denied" }),
  });
  const denied = createHarness({ startDir: "C:\\Users\\ASUS1", transport });
  denied.runtime.view("C:\\Users\\ASUS1\\blocked\\").load();
  await wait();
  await denied.runtime.view("C:\\Users\\ASUS1\\blocked\\").rows[0].run();
  assert.equal(denied.panel.error, "workspacePathMkdirFailed:permission denied");
  assert.equal(denied.panel.closed, undefined);

  const invalid = createHarness({
    startDir: "C:\\Users\\ASUS1",
    transport: createTransport({
      list: () => ({ ok: true, path: "C:\\Users\\ASUS1", platform: WIN, entries: [] }),
    }),
    createError: Object.assign(new Error("bad path"), { code: "workspace/invalid-path" }),
  });
  invalid.runtime.view("C:\\Users\\ASUS1\\").load();
  await wait();
  await invalid.runtime.view("C:\\Users\\ASUS1\\").rows[0].run();
  assert.equal(invalid.panel.error, "workspacePathInvalidPath");
  assert.equal(invalid.panel.closed, undefined);
});

test("a session start failure keeps the created workspace and the panel", async () => {
  const transport = createTransport({
    list: () => ({ ok: true, path: "C:\\Users\\ASUS1", platform: WIN, entries: [] }),
  });
  const harness = createHarness({ startDir: "C:\\Users\\ASUS1", transport });
  harness.api.services.uiWorkspace.startSession = () => {
    throw new Error("no");
  };
  harness.runtime.view("C:\\Users\\ASUS1\\").load();
  await wait();
  await harness.runtime.view("C:\\Users\\ASUS1\\").rows[0].run();
  assert.deepEqual(harness.created, ["C:\\Users\\ASUS1"]);
  assert.equal(harness.panel.error, "workspacePathSessionFailed");
  assert.equal(harness.panel.closed, undefined);
});

test("the list route path is the only transport the mode uses for listings", async () => {
  const harness = createHarness({
    startDir: "C:\\Users\\ASUS1",
    transport: createTransport({}),
  });
  harness.runtime.view("C:\\Users\\ASUS1\\").load();
  await wait();
  assert.equal(harness.transport.calls[0].input.startsWith(`${LIST_PATH}?path=`), true);
});
