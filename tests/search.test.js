import assert from "node:assert/strict";
import test from "node:test";
import { RESULT_LIMIT, filterEntries, fuzzyMatch } from "../src/data/search.js";

function entry(id, title, meta, updatedAt = 0) {
  return {
    id,
    title,
    titleLower: title.toLocaleLowerCase(),
    metaLower: meta.toLocaleLowerCase(),
    updatedAt,
  };
}

const entries = [
  entry("e1", "Fix parser", "alpha /p/alpha", 100),
  entry("e2", "Add tests", "alpha /p/alpha", 200),
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

test("the whole query is one fuzzy sequence, not separate terms", () => {
  const rows = filterEntries(entries, "fixpar");
  assert.deepEqual(rows.map((row) => row.entry.id), ["e1"]);
  assert.deepEqual([...rows[0].positions], [0, 1, 2, 4, 5, 6]);
});

test("matching ignores case and whitespace on both sides", () => {
  assert.deepEqual(
    filterEntries(entries, "  FIX   PARSER  ").map((row) => row.entry.id),
    ["e1"],
  );
  assert.deepEqual(
    filterEntries([entry("e3", "OpenSettings", "other")], "open set").map(
      (row) => row.entry.id,
    ),
    ["e3"],
  );
});

test("metadata matches never highlight the title and keep the base order", () => {
  const rows = filterEntries(entries, "alpha");
  assert.deepEqual(rows.map((row) => row.entry.id), ["e1", "e2"]);
  assert.ok(rows.every((row) => row.positions.size === 0));
});

test("a title match outranks any metadata match", () => {
  const rows = filterEntries(
    [
      entry("title", "a", "zzz"),
      entry("meta", "b", "a"),
    ],
    "a",
  );
  assert.deepEqual(rows.map((row) => row.entry.id), ["title", "meta"]);
});

test("no subsequence means no row", () => {
  assert.deepEqual(filterEntries(entries, "zzz"), []);
  assert.deepEqual(filterEntries(entries, "fix beta"), []);
});

test("fuzzyMatch returns positions in the original text", () => {
  assert.deepEqual(fuzzyMatch("fix parser", "fps").positions, [0, 4, 7]);
  assert.equal(fuzzyMatch("fix parser", "zz"), null);
});

test("the empty query is capped at the result limit", () => {
  const many = Array.from({ length: RESULT_LIMIT + 5 }, (_, index) =>
    entry(`id-${index}`, `Title ${index}`, ""),
  );
  assert.equal(filterEntries(many, "").length, RESULT_LIMIT);
});
