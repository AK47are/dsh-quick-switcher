import assert from "node:assert/strict";
import test from "node:test";
import { API_VERSION, defineModule, prefixMatcher } from "../module.js";
import { isModuleDefinition } from "../src/core/module.js";

test("defineModule keeps the id and setup and freezes the definition", () => {
  const setup = () => ({});
  const definition = defineModule("alpha", setup);
  assert.equal(definition.id, "alpha");
  assert.equal(definition.setup, setup);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(API_VERSION, 1);
});

test("a module id outside the lowercase-hyphen shape is rejected early", () => {
  assert.throws(() => defineModule("Alpha", () => ({})), /module id/);
  assert.throws(() => defineModule("alpha beta", () => ({})), /module id/);
  assert.throws(() => defineModule("", () => ({})), /module id/);
  assert.throws(() => defineModule(null, () => ({})), /module id/);
});

test("a definition needs a setup function", () => {
  assert.throws(() => defineModule("alpha"), /setup must be a function/);
  assert.throws(() => defineModule("alpha", {}), /setup must be a function/);
});

test("isModuleDefinition accepts definitions and plain equivalents only", () => {
  assert.equal(isModuleDefinition(defineModule("alpha", () => ({}))), true);
  assert.equal(isModuleDefinition({ id: "alpha", setup: () => ({}) }), true);
  assert.equal(isModuleDefinition({ id: "alpha" }), false);
  assert.equal(isModuleDefinition({ setup: () => ({}) }), false);
  assert.equal(isModuleDefinition(null), false);
  assert.equal(isModuleDefinition("alpha"), false);
});

test("prefixMatcher claims a leading trigger and maps the rest", () => {
  const view = () => ({ rows: [] });
  const matcher = prefixMatcher(">", { id: "commands", priority: 7, view });
  assert.equal(matcher.id, "commands");
  assert.equal(matcher.priority, 7);
  assert.equal(matcher.view, view);
  assert.deepEqual(matcher.match(">abc", {}), { filter: "abc" });
  assert.deepEqual(matcher.match(">", {}), { filter: "" });
  assert.equal(matcher.match("abc", {}), null);
  assert.equal(matcher.match(null, {}), null);

  const mapped = prefixMatcher("@", {
    id: "files",
    map: (filter, panel) => ({ filter, sessionId: panel.currentSessionId }),
    view,
  });
  assert.deepEqual(mapped.match("@src", { currentSessionId: "s1" }), {
    filter: "src",
    sessionId: "s1",
  });
  assert.equal(mapped.priority, 0);
});

test("prefixMatcher accepts several triggers and the first one wins", () => {
  const view = () => ({ rows: [] });
  const ask = prefixMatcher(["?", "？"], { id: "ask", view });
  assert.equal(ask.match("?q", {}).filter, "q");
  assert.equal(ask.match("？q", {}).filter, "q");
  assert.equal(ask.match("q?", {}), null);
  assert.equal(ask.match("", {}), null);

  // The array order, not the length, decides which overlapping trigger claims
  // the query; the remainder still starts with the longer one.
  const ordered = prefixMatcher([">", ">>"], { id: "commands", view });
  assert.deepEqual(ordered.match(">>a", {}), { filter: ">a" });

  const mapped = prefixMatcher(["@", "＠"], {
    id: "files",
    map: (text, panel) => ({ text, sessionId: panel.currentSessionId }),
    view,
  });
  assert.deepEqual(mapped.match("＠src", { currentSessionId: "s1" }), {
    text: "src",
    sessionId: "s1",
  });

  // The sessions list has always claimed every query with an empty prefix.
  const everything = prefixMatcher("", { id: "sessions", view });
  assert.deepEqual(everything.match("anything", {}), { filter: "anything" });
});

test("prefixMatcher rejects a missing or malformed option", () => {
  assert.throws(() => prefixMatcher(1, { id: "a", view() {} }), /string prefix/);
  assert.throws(() => prefixMatcher([], { id: "a", view() {} }), /string prefixes/);
  assert.throws(() => prefixMatcher([">", null], { id: "a", view() {} }), /string prefixes/);
  assert.throws(() => prefixMatcher([1], { id: "a", view() {} }), /string prefixes/);
  assert.throws(() => prefixMatcher(">", { view() {} }), /matcher id/);
  assert.throws(() => prefixMatcher(">", { id: "a" }), /view/);
  assert.throws(() => prefixMatcher(">", { id: "a", view() {}, map: 1 }), /map/);
});
