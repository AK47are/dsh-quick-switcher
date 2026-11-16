import assert from "node:assert/strict";
import test from "node:test";
import { rowTimeLabel } from "../src/core/lib/format.js";

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

function entry(overrides) {
  return {
    updatedAt: 0,
    recentAt: 0,
    status: { compactKey: null },
    ...overrides,
  };
}

test("the time label prefers the access time used for sorting", () => {
  const now = 1_000_000;
  assert.equal(
    rowTimeLabel(entry({ updatedAt: 0, recentAt: now - 60_000 }), t, now),
    "time.minutes:1",
  );
});

test("a missing access time falls back to updatedAt", () => {
  const now = 1_000_000;
  assert.equal(
    rowTimeLabel(entry({ updatedAt: now - 3_600_000, recentAt: 0 }), t, now),
    "time.hours:1",
  );
});

test("the compact pending label wins over both times", () => {
  assert.equal(
    rowTimeLabel(
      entry({ recentAt: 1, status: { compactKey: "statusCompactApproval" } }),
      t,
      1000,
    ),
    "statusCompactApproval",
  );
});

