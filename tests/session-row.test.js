import assert from "node:assert/strict";
import test from "node:test";
import { sessionRow } from "../src/routes/session-row.js";

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

const entry = {
  id: "session-63cb1fd1-27b3-4b86-9f99-1fc7d8937ffa",
  idKey: "63cb1fd127b34b869f991fc7d8937ffa",
  shortId: "63cb1fd1",
  title: "Alpha",
  workspace: "Alpha workspace",
  status: {
    state: "idle",
    kind: "idle",
    labelKey: "statusIdle",
    compactKey: null,
    subagentCount: 0,
  },
  recentAt: 0,
  updatedAt: 0,
  current: false,
};

test("the short code follows the workspace and the time", () => {
  const now = 10 * 60_000;
  const row = sessionRow(
    { ...entry, recentAt: now - 60_000 },
    { t, now },
    { showWorkspace: true },
  );
  assert.deepEqual(row.meta, [
    { text: "Alpha workspace", className: "dqs-workspace" },
    { text: "time.minutes:1", className: "dqs-time" },
    { text: "63cb1fd1", className: "dqs-session-id" },
  ]);
});

test("the scope list keeps the code without the workspace", () => {
  const row = sessionRow(entry, { t, now: 0 });
  assert.deepEqual(row.meta, [{ text: "63cb1fd1", className: "dqs-session-id" }]);
});

test("an id too short to search renders no code", () => {
  const row = sessionRow({ ...entry, shortId: "" }, { t, now: 0 });
  assert.deepEqual(row.meta, []);
});
