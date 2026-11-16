import assert from "node:assert/strict";
import test from "node:test";
import { collectSessionEntries } from "../src/modules/sessions/projection.js";

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

test("entries carry the canonical id key and the short code", () => {
  const id = "session-63cb1fd1-27b3-4b86-9f99-1fc7d8937ffa";
  const list = listOf([session({ id, title: "Tracked", updatedAt: 100 })]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, new Map(), false);
  assert.equal(entries[0].idKey, "63cb1fd127b34b869f991fc7d8937ffa");
  assert.equal(entries[0].shortId, "63cb1fd1");
});

test("an id too short to search shows no short code", () => {
  const list = listOf([session({ id: "ab", title: "Tiny", updatedAt: 100 })]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, new Map(), false);
  assert.equal(entries[0].idKey, "ab");
  assert.equal(entries[0].shortId, "");
});

/**
 * A list with a current row and a pinned previous row, so the pending rows stay
 * inside their own group instead of becoming the pinned one.
 */
function pendingList() {
  return listOf([
    session({ id: "now", title: "Current", updatedAt: 10, retainedBy: { mainView: 1 } }),
    session({ id: "prev", title: "Previous", updatedAt: 20 }),
    session({ id: "a", title: "Waited three days", updatedAt: 300 }),
    session({ id: "b", title: "Waited ten minutes", updatedAt: 1000 }),
    session({ id: "c", title: "Opened just now", updatedAt: 200 }),
  ]);
}

const allPending = new Map([
  ["a", { pendingInteraction: { kind: "approval" } }],
  ["b", { pendingInteraction: { kind: "question" } }],
  ["c", { pendingInteraction: { kind: "plan-review" } }],
]);

test("the default pending order leads with unopened rows", () => {
  const access = new Map([
    ["now", 9000],
    ["prev", 8000],
    ["c", 2000],
  ]);
  const { entries } = collectSessionEntries(pendingList(), emptyWorkspaces, allPending, false, access);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["prev", "a", "b", "c", "now"],
  );
});

test("a visit moves a pending row to the end of its group", () => {
  const before = new Map([
    ["now", 9000],
    ["prev", 8000],
    ["a", 100],
    ["b", 1000],
    ["c", 2000],
  ]);
  const first = collectSessionEntries(pendingList(), emptyWorkspaces, allPending, false, before);
  assert.deepEqual(
    first.entries.map((entry) => entry.id),
    ["prev", "a", "b", "c", "now"],
  );

  const after = new Map(before).set("a", 3000);
  const second = collectSessionEntries(pendingList(), emptyWorkspaces, allPending, false, after);
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    ["prev", "b", "c", "a", "now"],
  );
});

test("the most recent preference restores the list-wide rule", () => {
  const access = new Map([
    ["now", 9000],
    ["prev", 8000],
    ["c", 2000],
  ]);
  const { entries } = collectSessionEntries(
    pendingList(),
    emptyWorkspaces,
    allPending,
    false,
    access,
    "most-recent",
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["prev", "c", "b", "a", "now"],
  );
});

test("the pending order leaves the other groups on recent time", () => {
  const list = listOf([
    session({ id: "now", title: "Current", updatedAt: 10, retainedBy: { mainView: 1 } }),
    session({ id: "prev", title: "Previous", updatedAt: 20 }),
    session({ id: "old-idle", title: "Old idle", updatedAt: 100 }),
    session({ id: "new-idle", title: "New idle", updatedAt: 900 }),
    session({ id: "waiting", title: "Waiting", updatedAt: 500 }),
  ]);
  const statuses = new Map([["waiting", { pendingInteraction: { kind: "approval" } }]]);
  const access = new Map([
    ["prev", 8000],
    ["old-idle", 1000],
    ["new-idle", 100],
  ]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, statuses, false, access);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["prev", "waiting", "old-idle", "new-idle", "now"],
  );
});

test("a pinned pending row still leads the list", () => {
  const list = listOf([
    session({ id: "open", title: "Current", updatedAt: 900, retainedBy: { mainView: 1 } }),
    session({ id: "prev", title: "Previous", updatedAt: 100 }),
    session({ id: "other", title: "Other", updatedAt: 500 }),
  ]);
  const statuses = new Map([
    ["prev", { pendingInteraction: { kind: "approval" } }],
    ["other", { pendingInteraction: { kind: "question" } }],
  ]);
  const access = new Map([
    ["open", 900],
    ["prev", 800],
    ["other", 700],
  ]);
  const { entries } = collectSessionEntries(list, emptyWorkspaces, statuses, false, access);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["prev", "other", "open"],
  );
  assert.equal(entries[0].pinned, true);
  assert.equal(entries[0].current, false);
});

