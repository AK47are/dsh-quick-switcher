import assert from "node:assert/strict";
import test from "node:test";
import { collectSessionEntries } from "../src/data/sessions.js";

function session(overrides) {
  return {
    title: "Session",
    updatedAt: 0,
    retainedBy: {},
    running: false,
    ...overrides,
  };
}

const statuses = new Map([
  ["a", { running: true }],
  ["b", { pendingInteraction: { kind: "approval" } }],
  ["f", { completionUnread: true }],
]);

const sessionList = {
  ids: ["a", "b", "c", "d", "e", "f"],
  byId: {
    a: session({ id: "a", title: "Alpha", updatedAt: 600, retainedBy: { mainView: 1 } }),
    b: session({ id: "b", title: "Blank", blank: true }),
    c: session({ id: "c", title: "Child", parentId: "a" }),
    d: session({ id: "d", title: "Subagent", origin: "subagent" }),
    e: session({ id: "e", title: "Archived", updatedAt: 50 }),
    f: session({ id: "f", title: "Beta", updatedAt: 400 }),
  },
  projectionsBySession: {},
};

const workspaceList = {
  items: [
    {
      workspaceId: "w1",
      title: "Alpha",
      path: "/p/alpha",
      sessionIds: ["a", "b", "c", "d", "e", "f"],
    },
  ],
  archivedSessionIds: ["e"],
};

test("hides archived, blank, child, and subagent sessions", () => {
  const { entries } = collectSessionEntries(sessionList, workspaceList, statuses, false);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["f", "a"],
  );
});

test("marks the retained main-view session as current", () => {
  const { entries, currentId } = collectSessionEntries(
    sessionList,
    workspaceList,
    statuses,
    false,
  );
  assert.equal(currentId, "a");
  assert.equal(entries.find((entry) => entry.id === "a").current, true);
  assert.equal(entries.find((entry) => entry.id === "f").current, false);
});

test("an active main panel clears the current marker", () => {
  const { entries, currentId } = collectSessionEntries(
    sessionList,
    workspaceList,
    statuses,
    true,
  );
  assert.equal(currentId, null);
  assert.ok(entries.every((entry) => entry.current === false));
});

test("status precedence: pending, running, subagents, completion", () => {
  const { entries } = collectSessionEntries(sessionList, workspaceList, statuses, false);
  assert.equal(entries.find((entry) => entry.id === "b"), undefined);
  assert.equal(entries.find((entry) => entry.id === "a").status.state, "ongoing");
  assert.equal(entries.find((entry) => entry.id === "f").status.state, "done");

  const withCatalog = {
    ...sessionList,
    projectionsBySession: {
      a: { values: { subagentCatalog: [{ id: "f" }] } },
    },
  };
  const runningChildren = new Map([
    ["a", { running: false }],
    ["f", { running: true }],
  ]);
  const { entries: parentEntries } = collectSessionEntries(
    withCatalog,
    workspaceList,
    runningChildren,
    false,
  );
  const parent = parentEntries.find((entry) => entry.id === "a");
  assert.equal(parent.status.kind, "subagents");
  assert.equal(parent.status.subagentCount, 1);
});

test("pending interaction wins over running and completion", () => {
  const pending = new Map([
    ["a", { running: true, completionUnread: true, pendingInteraction: { kind: "question" } }],
  ]);
  const { entries } = collectSessionEntries(sessionList, workspaceList, pending, false);
  const row = entries.find((entry) => entry.id === "a");
  assert.equal(row.status.state, "warning");
  assert.equal(row.status.labelKey, "statusWaitingAnswer");
  assert.equal(row.status.compactKey, "statusCompactAnswer");
});

function listOf(rows) {
  return {
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    projectionsBySession: {},
  };
}

const emptyWorkspaces = { items: [], archivedSessionIds: [] };

test("empty query sorts by status rank before recency", () => {
  const list = listOf([
    session({ id: "x", title: "Idle newest", updatedAt: 900 }),
    session({ id: "y", title: "Done older", updatedAt: 100 }),
    session({ id: "z", title: "Pending oldest", updatedAt: 50 }),
  ]);
  const rankStatuses = new Map([
    ["y", { completionUnread: true }],
    ["z", { pendingInteraction: { kind: "approval" } }],
  ]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, rankStatuses, false);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["y", "z", "x"],
  );
});

test("access time orders one status and falls back to updatedAt", () => {
  const list = listOf([
    session({ id: "p", title: "Seen now", updatedAt: 100 }),
    session({ id: "q", title: "Unseen newer", updatedAt: 800 }),
  ]);
  const access = new Map([["p", 900]]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, new Map(), false, access);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["p", "q"],
  );
  assert.equal(entries[0].recentAt, 900);
  assert.equal(entries[1].recentAt, 800);

  const reversed = new Map([["q", 1000]]);
  const { entries: next } = collectSessionEntries(
    list,
    emptyWorkspaces,
    new Map(),
    false,
    reversed,
  );
  assert.deepEqual(
    next.map((entry) => entry.id),
    ["q", "p"],
  );
});

test("the previous session leads over the current one", () => {
  const list = listOf([
    session({ id: "now", title: "Current", updatedAt: 900, retainedBy: { mainView: 1 } }),
    session({ id: "prev", title: "Previous", updatedAt: 100 }),
  ]);
  const access = new Map([
    ["now", 900],
    ["prev", 800],
  ]);
  const { entries, currentId } = collectSessionEntries(
    list,
    emptyWorkspaces,
    new Map(),
    false,
    access,
  );
  assert.equal(currentId, "now");
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["prev", "now"],
  );
  assert.equal(entries[0].pinned, true);
  assert.equal(entries[0].current, false);
  assert.equal(entries[1].current, true);
});

test("a main panel page pins the last conversation", () => {
  const list = listOf([
    session({
      id: "last",
      title: "Last conversation",
      updatedAt: 100,
      retainedBy: { mainView: 1 },
    }),
    session({ id: "older", title: "Older", updatedAt: 900 }),
  ]);
  const access = new Map([
    ["last", 800],
    ["older", 700],
  ]);
  const { entries, currentId } = collectSessionEntries(
    list,
    emptyWorkspaces,
    new Map(),
    true,
    access,
  );
  assert.equal(currentId, null);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["last", "older"],
  );
  assert.equal(entries[0].pinned, true);
  assert.equal(entries[0].current, false);
});

test("no access history means no pin", () => {
  const list = listOf([
    session({ id: "now", title: "Current", updatedAt: 100, retainedBy: { mainView: 1 } }),
    session({ id: "done", title: "Done", updatedAt: 50 }),
  ]);
  const done = new Map([["done", { completionUnread: true }]]);
  const { entries, currentId } = collectSessionEntries(list, emptyWorkspaces, done, false);
  assert.equal(currentId, "now");
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["done", "now"],
  );
  assert.ok(entries.every((entry) => entry.pinned === false));
});
