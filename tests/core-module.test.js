import assert from "node:assert/strict";
import test from "node:test";
import { API_VERSION, defineModule } from "../module.js";
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
