import assert from "node:assert/strict";
import test from "node:test";
import { collectWorkspaceRows } from "../src/modules/sessions/projection.js";

function entry(id, title, workspace, updatedAt) {
  return {
    id,
    title,
    titleLower: title.toLocaleLowerCase(),
    workspace,
    path: `/p/${workspace}`,
    metaLower: `${workspace} /p/${workspace}`.toLocaleLowerCase(),
    updatedAt,
  };
}

// The switcher hands entries over in display order (retained, status, access),
// so the fixture keeps that order instead of sorting by updatedAt.
const entries = [
  entry("e2", "Add tests", "Alpha", 200),
  entry("e1", "Fix parser", "Alpha", 100),
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

test("scope sessions keep the incoming display order and the newest activity", () => {
  const displayOrder = [
    entry("e1", "Fix parser", "Alpha", 100),
    entry("e2", "Add tests", "Alpha", 200),
  ];
  const rows = collectWorkspaceRows(workspaceList, displayOrder);
  assert.deepEqual(
    rows[0].sessions.map((session) => session.id),
    ["e1", "e2"],
  );
  assert.equal(rows[0].updatedAt, 200);
});
