import assert from "node:assert/strict";
import test from "node:test";
import { filterEntries, matchPositions } from "../src/data/search.js";

const entries = [
  {
    id: "e1",
    title: "Fix parser",
    titleLower: "fix parser",
    metaLower: "alpha /p/alpha",
    updatedAt: 100,
  },
  {
    id: "e2",
    title: "Add tests",
    titleLower: "add tests",
    metaLower: "alpha /p/alpha",
    updatedAt: 200,
  },
];

test("empty query keeps input order", () => {
  assert.deepEqual(
    filterEntries(entries, "").map((row) => row.entry.id),
    ["e1", "e2"],
  );
});

test("title match wins and carries highlight positions", () => {
  const rows = filterEntries(entries, "parser");
  assert.deepEqual(rows.map((row) => row.entry.id), ["e1"]);
  assert.deepEqual([...rows[0].positions], [4, 5, 6, 7, 8, 9]);
});

test("metadata matches never highlight the title", () => {
  const rows = filterEntries(entries, "alpha");
  assert.deepEqual(rows.map((row) => row.entry.id), ["e2", "e1"]);
  assert.ok(rows.every((row) => row.positions.size === 0));
});

test("every term must match", () => {
  assert.deepEqual(
    filterEntries(entries, "fix alpha").map((row) => row.entry.id),
    ["e1"],
  );
  assert.deepEqual(filterEntries(entries, "fix beta"), []);
});

test("fuzzy match positions are a subsequence", () => {
  assert.deepEqual(matchPositions("fix parser", "fps"), [0, 4, 7]);
  assert.equal(matchPositions("fix parser", "zz"), null);
});
