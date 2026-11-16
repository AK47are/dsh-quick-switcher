import assert from "node:assert/strict";
import test from "node:test";
import { resolveDefaultMode, seedForOpen } from "../src/core/lib/default-mode.js";

function modulesOf(...entries) {
  return entries.map(([id, seed, isEnabled = true, labelKey]) => ({
    id,
    isEnabled,
    entry: seed === null ? null : { seed, labelKey },
  }));
}

test("the first entry is the effective default until the user chooses one", () => {
  const modules = modulesOf(["sessions", "", true, "sessionsEntryTitle"], ["files", "@"]);
  const resolved = resolveDefaultMode(modules, null);
  assert.equal(resolved.moduleId, "sessions");
  assert.equal(resolved.seed, "");
  assert.equal(resolved.isEnabled, true);
});

test("a stored choice names the module and supplies its seed", () => {
  const modules = modulesOf(["sessions", ""], ["files", "@"]);
  const resolved = resolveDefaultMode(modules, "files");
  assert.equal(resolved.moduleId, "files");
  assert.equal(resolved.seed, "@");
});

test("a switched-off choice falls back to an empty seed without losing the choice", () => {
  const modules = modulesOf(["sessions", ""], ["files", "@", false]);
  const resolved = resolveDefaultMode(modules, "files");
  assert.equal(resolved.moduleId, "files");
  assert.equal(resolved.entry.seed, "@");
  assert.equal(resolved.isEnabled, false);
  assert.equal(resolved.seed, "");
});

test("a missing choice falls back to an empty seed and stays reported", () => {
  const modules = modulesOf(["sessions", ""]);
  const resolved = resolveDefaultMode(modules, "removed-module");
  assert.equal(resolved.moduleId, "removed-module");
  assert.equal(resolved.entry, null);
  assert.equal(resolved.seed, "");
});

test("no entries leaves the panel on its empty query", () => {
  const resolved = resolveDefaultMode(modulesOf(["files", null]), "files");
  assert.deepEqual(resolved, { moduleId: null, entry: null, isEnabled: false, seed: "" });
});

test("an explicit seed wins over the preference, including the empty string", () => {
  const modules = modulesOf(["sessions", ""], ["files", "@"]);
  assert.equal(seedForOpen(undefined, modules, "files"), "@");
  assert.equal(seedForOpen({}, modules, "files"), "@");
  assert.equal(seedForOpen({ seed: "!" }, modules, "files"), "!");
  assert.equal(seedForOpen({ seed: "" }, modules, "files"), "");
  assert.equal(seedForOpen({ seed: 42 }, modules, "files"), "@");
});
