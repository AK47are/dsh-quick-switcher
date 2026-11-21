import assert from "node:assert/strict";
import test from "node:test";
import { createSharedStores } from "../src/core/shared-store.js";
import { createSessionRow } from "../src/modules/sessions/row.js";
import { collectWorkspaceRows, projectSessionData } from "../src/modules/sessions/projection.js";
import { createSessionsView } from "../src/modules/sessions/view.js";

function sessionList(rows) {
  return { ids: rows.map((row) => row.id), byId: Object.fromEntries(rows.map((row) => [row.id, row])) };
}

function workspacesOf(ids) {
  return {
    items: [{ workspaceId: "w1", title: "Work", path: "/work", sessionIds: ids }],
    archivedSessionIds: [],
  };
}

const t = (key, params) => (params === undefined ? key : `${key}:${params.count}`);

function panelOf(overrides = {}) {
  return {
    now: 10_000,
    currentSessionId: "s1",
    activePanelId: null,
    close(options) {
      this.closed = options;
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

test("visible sessions are projected with current, pinned and status order", () => {
  const list = sessionList([
    { id: "s1", title: "One", updatedAt: 1000, retainedBy: { mainView: 1 } },
    { id: "s2", title: "Two", updatedAt: 2000 },
    { id: "s3", title: "Three", updatedAt: 3000 },
  ]);
  const statuses = new Map([
    ["s1", { pendingInteraction: { kind: "approval" } }],
    ["s2", { completionUnread: true }],
  ]);
  const data = projectSessionData({
    sessionList: list,
    workspaceList: workspacesOf(["s1", "s2", "s3"]),
    statuses,
    activePanelId: null,
    accessTimes: new Map([["s3", 5000]]),
    pendingOrder: "least-recent",
  });
  assert.equal(data.currentId, "s1");
  assert.deepEqual(
    data.entries.map((entry) => entry.id),
    ["s3", "s2", "s1"],
  );
  const s3 = data.entries[0];
  assert.equal(s3.pinned, true);
  assert.equal(s3.current, false);
  assert.equal(data.entries[1].status.state, "done");
  assert.equal(data.entries[2].status.state, "warning");
  assert.equal(data.workspaceRows.length, 1);
  assert.equal(data.workspaceRows[0].count, 3);
  assert.deepEqual(
    data.workspaceRows[0].sessions.map((entry) => entry.id),
    ["s3", "s2", "s1"],
  );
});

test("archived sessions go to their own list while blank and subagent rows stay out", () => {
  const list = sessionList([
    { id: "s1", title: "One", updatedAt: 1000 },
    { id: "s2", title: "Blank", blank: true },
    { id: "s3", title: "Child", parentId: "s1" },
    { id: "s4", title: "Sub", origin: "subagent" },
    { id: "s5", title: "Archived old", updatedAt: 2000 },
    { id: "s6", title: "Archived new", updatedAt: 3000 },
  ]);
  const workspaceList = workspacesOf(["s1", "s2", "s3", "s4", "s5", "s6"]);
  workspaceList.archivedSessionIds = ["s2", "s3", "s4", "s5", "s6"];
  const data = projectSessionData({
    sessionList: list,
    workspaceList,
    statuses: new Map(),
    activePanelId: null,
    accessTimes: new Map(),
    pendingOrder: undefined,
  });
  assert.deepEqual(
    data.entries.map((entry) => entry.id),
    ["s1"],
  );
  // Archiving does not make a blank, child or subagent row searchable: those
  // have no conversation of their own, so the archive list skips them too.
  assert.deepEqual(
    data.archivedEntries.map((entry) => entry.id),
    ["s6", "s5"],
  );
  const newest = data.archivedEntries[0];
  assert.equal(newest.workspace, "Work");
  assert.equal(newest.status.state, "idle");
  assert.equal(newest.lastAccessAt, 0);
  assert.equal(newest.recentAt, 3000);
});

test("a main panel makes every session non-current and unpins nothing", () => {
  const list = sessionList([
    { id: "s1", title: "One", updatedAt: 1000, retainedBy: { mainView: 1 } },
    { id: "s2", title: "Two", updatedAt: 2000 },
  ]);
  const data = projectSessionData({
    sessionList: list,
    workspaceList: workspacesOf(["s1", "s2"]),
    statuses: new Map(),
    activePanelId: "plugin-page",
    accessTimes: new Map([["s2", 9000]]),
    pendingOrder: undefined,
  });
  assert.equal(data.currentId, null);
  assert.equal(data.entries.some((entry) => entry.current), false);
  assert.equal(data.entries[0].pinned, true);
});

test("the pending order setting flips the warning group's order", () => {
  // s0 stays pinned and ahead of the group, so the assertion sees the pending
  // comparator rather than the previous-session row.
  const list = sessionList([
    { id: "s0", title: "Zero", updatedAt: 100 },
    { id: "s1", title: "One", updatedAt: 1000 },
    { id: "s2", title: "Two", updatedAt: 2000 },
  ]);
  const statuses = new Map([
    ["s1", { pendingInteraction: { kind: "question" } }],
    ["s2", { pendingInteraction: { kind: "approval" } }],
  ]);
  const base = {
    sessionList: list,
    workspaceList: workspacesOf(["s0", "s1", "s2"]),
    statuses,
    activePanelId: null,
  };
  const bothSeen = { ...base, accessTimes: new Map([["s0", 9000], ["s1", 5000], ["s2", 1000]]) };
  assert.deepEqual(
    projectSessionData({ ...bothSeen, pendingOrder: "least-recent" }).entries.map((entry) => entry.id),
    ["s0", "s2", "s1"],
  );
  assert.deepEqual(
    projectSessionData({ ...bothSeen, pendingOrder: "most-recent" }).entries.map((entry) => entry.id),
    ["s0", "s1", "s2"],
  );

  const oneUnvisited = { ...base, accessTimes: new Map([["s0", 9000], ["s1", 5000]]) };
  assert.deepEqual(
    projectSessionData({ ...oneUnvisited, pendingOrder: "least-recent" }).entries.map((entry) => entry.id),
    ["s0", "s2", "s1"],
  );
  assert.deepEqual(
    projectSessionData({ ...oneUnvisited, pendingOrder: "most-recent" }).entries.map((entry) => entry.id),
    ["s0", "s1", "s2"],
  );
});

test("a workspace row counts only visible sessions and sorts by newest activity", () => {
  const entries = [
    { id: "s1", updatedAt: 1000 },
    { id: "s2", updatedAt: 5000 },
    { id: "s3", updatedAt: 100 },
  ];
  const rows = collectWorkspaceRows(
    {
      items: [
        { workspaceId: "w1", title: "Quiet", path: "/quiet", sessionIds: ["s1"] },
        { workspaceId: "w2", title: "Busy", path: "/busy", sessionIds: ["s2", "s3", "missing"] },
      ],
    },
    entries,
  );
  assert.deepEqual(
    rows.map((row) => row.workspaceId),
    ["w2", "w1"],
  );
  assert.equal(rows[0].count, 2);
});

test("the session row carries the workspace, time, short id and current badge", () => {
  const calls = [];
  const rowFor = createSessionRow({
    t,
    openSession(panel, id) {
      calls.push(["open", id]);
      return true;
    },
  });
  const entry = {
    id: "s1",
    title: "One",
    workspace: "Work",
    shortId: "abc12345",
    status: {
      state: "idle",
      kind: "idle",
      labelKey: "statusIdle",
      compactKey: null,
      subagentCount: 0,
    },
    current: true,
    pinned: false,
    updatedAt: 5000,
    lastAccessAt: 9000,
  };
  const panel = panelOf();
  const row = rowFor(entry, panel, { showWorkspace: true, positions: new Set([0]) });
  assert.equal(row.key, "s:s1");
  assert.equal(row.badge, "current");
  assert.equal(row.status, null);
  assert.equal(row.meta[0].text, "Work");
  assert.ok(row.meta.some((item) => item.className === "dqs-time"));
  assert.equal(row.meta.at(-1).text, "abc12345");
  row.run();
  assert.deepEqual(calls, []);
  assert.equal(panel.closed, undefined);
});

test("a non-current session row opens the session and closes without restoring focus", () => {
  const calls = [];
  const rowFor = createSessionRow({
    t,
    openSession(panel, id) {
      calls.push(["open", id]);
      return true;
    },
  });
  const panel = panelOf();
  const row = rowFor(
    {
      id: "s2",
      title: "Two",
      workspace: "",
      shortId: "",
      status: {
        state: "warning",
        kind: "pending",
        labelKey: "statusWaitingApproval",
        compactKey: "statusCompactApproval",
        subagentCount: 0,
      },
      current: false,
      pinned: false,
      updatedAt: 1000,
      lastAccessAt: 0,
    },
    panel,
  );
  assert.equal(row.badge, null);
  assert.deepEqual(row.status, { state: "warning", label: "statusWaitingApproval" });
  row.run();
  assert.deepEqual(calls, [["open", "s2"]]);
  assert.deepEqual(panel.closed, { restoreFocus: false });
});

test("the default view filters the shared entries and exposes every mode hint", () => {
  const shared = createSharedStores().store("session-data");
  const rowFor = createSessionRow({ t, openSession: () => true });
  const view = createSessionsView({ api: { t }, shared, rowFor });
  const data = projectSessionData({
    sessionList: sessionList([
      { id: "s1", title: "Alpha", updatedAt: 1000 },
      { id: "s2", title: "Beta", updatedAt: 2000 },
    ]),
    workspaceList: workspacesOf(["s1", "s2"]),
    statuses: new Map(),
    activePanelId: null,
    accessTimes: new Map(),
    pendingOrder: undefined,
  });
  shared.publish({ ...data, rowFor });
  const panel = panelOf();
  const all = view({ filter: "" }, panel);
  assert.equal(all.rows.length, 2);
  assert.equal(all.placeholder, "placeholder");
  assert.equal(all.count, "count:2");
  assert.equal(all.hints.length, 10);
  assert.deepEqual(
    all.hints.map((hint) => hint.keys[0]),
    ["Enter", "Esc", "+", "=", ">", "@", "!", "#", "~", "?"],
  );
  const filtered = view({ filter: "beta" }, panel);
  assert.deepEqual(
    filtered.rows.map((row) => row.key),
    ["s:s2"],
  );
  assert.equal(filtered.emptyText, null);
  assert.equal(view({ filter: "zzz" }, panel).emptyText, "empty");
});

test("a view without a published snapshot still renders its empty state", () => {
  const shared = createSharedStores().store("session-data");
  const rowFor = createSessionRow({ t, openSession: () => true });
  const view = createSessionsView({ api: { t }, shared, rowFor });
  const state = view({ filter: "" }, panelOf());
  assert.deepEqual(state.rows, []);
  assert.equal(state.emptyText, "empty");
});
