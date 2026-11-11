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
    ["a", "f"],
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
