import assert from "node:assert/strict";
import test from "node:test";
import { collectWorkspaceRows } from "../src/data/workspaces.js";
import { createWorkspacesRoute } from "../src/routes/workspaces.js";

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

function idleStatus() {
  return {
    state: "idle",
    kind: "idle",
    labelKey: "statusIdle",
    compactKey: null,
    subagentCount: 0,
  };
}

function entry(id, title, workspace, updatedAt) {
  return {
    id,
    title,
    titleLower: title.toLocaleLowerCase(),
    workspace,
    path: `/p/${workspace}`,
    metaLower: `${workspace} /p/${workspace}`.toLocaleLowerCase(),
    updatedAt,
    status: idleStatus(),
    current: false,
  };
}

const entries = [
  entry("e1", "Fix parser", "Alpha", 100),
  entry("e2", "Add tests", "Alpha", 200),
  entry("e3", "Docs", "Beta project", 50),
];

const workspaceList = {
  items: [
    { workspaceId: "w1", title: "Alpha", path: "C:\\p\\alpha", sessionIds: ["e1", "e2", "gone"] },
    { workspaceId: "w2", title: "Beta project", path: "/p/beta", sessionIds: ["e3"] },
    { workspaceId: "w3", title: "Empty", path: "/p/empty", sessionIds: [] },
  ],
  archivedSessionIds: [],
};

function context(workspaceRows, currentId = null) {
  return { sessionEntries: entries, workspaceRows, currentId, t, now: 0 };
}

function activation(record) {
  return {
    openSession(sessionId) {
      record.push(sessionId);
      return true;
    },
    startSession(workspaceId) {
      record.push(workspaceId);
      return true;
    },
  };
}

test("workspaces sort by activity and count visible sessions", () => {
  const rows = collectWorkspaceRows(workspaceList, entries);
  assert.deepEqual(
    rows.map((row) => [row.workspaceId, row.count]),
    [
      ["w1", 2],
      ["w2", 1],
      ["w3", 0],
    ],
  );
});

test("plus lists workspaces and copies filter fields", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();
  const view = route.view(route.parse("+", ctx), ctx);
  assert.equal(view.placeholder, "placeholderWorkspaces");
  assert.equal(view.count, "countWorkspaces:3");
  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["w:w1", "w:w2", "w:w3"],
  );
  assert.equal(view.rows[0].trailing, "count:2");
});

test("Enter enters the workspace and selects its most recent session", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();
  const effect = route
    .view(route.parse("+", ctx), ctx)
    .rows.find((row) => row.key === "w:w1")
    .run(activation([]));
  assert.deepEqual(effect, {
    type: "query",
    query: "+Alpha ",
    selectedKey: "s:e2",
  });

  const scoped = route.view(route.parse(effect.query, ctx), ctx);
  assert.deepEqual(
    scoped.rows.map((row) => row.key),
    ["c:w1", "s:e2", "s:e1"],
  );
  assert.equal(scoped.rows[0].action, true);
  assert.equal(scoped.count, "count:2");
});

test("Enter prefers the current session inside the workspace", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows, "e1");
  const route = createWorkspacesRoute();
  const effect = route
    .view(route.parse("+", ctx), ctx)
    .rows.find((row) => row.key === "w:w1")
    .run(activation([]));
  assert.equal(effect.selectedKey, "s:e1");
});

test("scope filters sessions and returns to the list without the space", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();
  route
    .view(route.parse("+", ctx), ctx)
    .rows.find((row) => row.key === "w:w1")
    .run(activation([]));

  const filtered = route.view(route.parse("+Alpha fix", ctx), ctx);
  assert.deepEqual(
    filtered.rows.map((row) => row.key),
    ["c:w1", "s:e1"],
  );

  const back = route.parse("+Alpha", ctx);
  assert.equal(back.mode, "list");
  assert.deepEqual(
    route.view(back, ctx).rows.map((row) => row.key),
    ["w:w1"],
  );
});

test("a typed full title with a space enters the scope", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();
  const scoped = route.parse("+Beta project ", ctx);
  assert.equal(scoped.mode, "scope");
  assert.equal(scoped.workspace.workspaceId, "w2");
  assert.equal(route.parse("+Beta project", ctx).mode, "list");
});

test("the longest title wins when titles overlap", () => {
  const shortEntry = entry("q1e", "One", "dsh", 10);
  const longEntry = entry("q2e", "Two", "dsh quick", 20);
  const rows = collectWorkspaceRows(
    {
      items: [
        { workspaceId: "q1", title: "dsh", path: "/p/dsh", sessionIds: ["q1e"] },
        { workspaceId: "q2", title: "dsh quick", path: "/p/dsh-quick", sessionIds: ["q2e"] },
      ],
    },
    [shortEntry, longEntry],
  );
  const ctx = { sessionEntries: [shortEntry, longEntry], workspaceRows: rows, currentId: null, t, now: 0 };
  const route = createWorkspacesRoute();

  const longest = route.parse("+dsh quick anything", ctx);
  assert.equal(longest.mode, "scope");
  assert.equal(longest.workspace.workspaceId, "q2");
  assert.equal(longest.filter, "anything");

  const shorter = route.parse("+dsh quickfix", ctx);
  assert.equal(shorter.mode, "scope");
  assert.equal(shorter.workspace.workspaceId, "q1");
  assert.equal(shorter.filter, "quickfix");
});

test("duplicate titles stay unambiguous after Enter", () => {
  const rows = collectWorkspaceRows(
    {
      items: [
        { workspaceId: "d1", title: "Dup", path: "/p/one", sessionIds: [] },
        { workspaceId: "d2", title: "Dup", path: "/p/two", sessionIds: [] },
      ],
    },
    [],
  );
  const ctx = { sessionEntries: [], workspaceRows: rows, currentId: null, t, now: 0 };
  const route = createWorkspacesRoute();
  const effect = route
    .view(route.parse("+", ctx), ctx)
    .rows.find((row) => row.key === "w:d2")
    .run(activation([]));
  assert.equal(effect.query, "+Dup ");
  const scoped = route.parse(effect.query, ctx);
  assert.equal(scoped.mode, "scope");
  assert.equal(scoped.workspace.workspaceId, "d2");
});

test("Shift+Enter and the create row start a session", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();
  const record = [];
  const shiftEffect = route
    .view(route.parse("+", ctx), ctx)
    .rows.find((row) => row.key === "w:w2")
    .shiftRun(activation(record));
  assert.equal(shiftEffect.type, "close");
  assert.deepEqual(record, ["w2"]);

  const createEffect = route
    .view(route.parse("+Empty ", ctx), ctx)
    .rows[0]
    .run(activation(record));
  assert.equal(createEffect.type, "close");
  assert.deepEqual(record, ["w2", "w3"]);
});

test("empty workspaces and empty filters explain themselves", () => {
  const workspaceRows = collectWorkspaceRows(workspaceList, entries);
  const ctx = context(workspaceRows);
  const route = createWorkspacesRoute();

  const emptyList = route.view(route.parse("+zzz", ctx), ctx);
  assert.equal(emptyList.emptyText, "emptyWorkspaces");

  const emptyScope = route.view(route.parse("+Empty ", ctx), ctx);
  assert.equal(emptyScope.note, "emptyWorkspaceSessions");

  const noMatch = route.view(route.parse("+Alpha zzz", ctx), ctx);
  assert.equal(noMatch.note, "empty");
});
