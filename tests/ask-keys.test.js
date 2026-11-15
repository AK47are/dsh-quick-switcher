import assert from "node:assert/strict";
import test from "node:test";
import { detailKeyAction } from "../src/panel/ask-keys.js";

/** A keydown shape carrying only the fields the helper reads. */
function press(overrides = {}) {
  return {
    key: "i",
    repeat: false,
    isComposing: false,
    keyCode: 73,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...overrides,
  };
}

/** Everything a finished record allows; individual tests take one away. */
function state(overrides = {}) {
  return {
    hasBack: true,
    isEditable: false,
    isRunning: false,
    canCopy: true,
    canRegenerate: true,
    canFork: true,
    isForking: false,
    ...overrides,
  };
}

test("i returns to the input from anywhere in the detail", () => {
  assert.equal(detailKeyAction(press(), state()), "back");
  assert.equal(detailKeyAction(press({ key: "I" }), state()), "back");
  // The locked question field is not a text surface for this key.
  assert.equal(detailKeyAction(press(), state({ isEditable: true })), "back");
  // A view with no back action leaves the key to the browser.
  assert.equal(detailKeyAction(press(), state({ hasBack: false })), null);
});

test("Backspace is no longer a back key", () => {
  assert.equal(detailKeyAction(press({ key: "Backspace", keyCode: 8 }), state()), null);
});

test("the letter actions keep their eligibility rules", () => {
  assert.equal(detailKeyAction(press({ key: "s" }), state({ isRunning: true })), "stop");
  assert.equal(detailKeyAction(press({ key: "s" }), state()), null);
  assert.equal(detailKeyAction(press({ key: "c" }), state()), "copy");
  assert.equal(detailKeyAction(press({ key: "c" }), state({ canCopy: false })), null);
  assert.equal(detailKeyAction(press({ key: "r" }), state()), "regenerate");
  assert.equal(detailKeyAction(press({ key: "r" }), state({ canRegenerate: false })), null);
  assert.equal(detailKeyAction(press({ key: "f" }), state()), "fork");
  assert.equal(detailKeyAction(press({ key: "f" }), state({ canFork: false })), null);
  assert.equal(detailKeyAction(press({ key: "f" }), state({ isForking: true })), null);
});

test("the locked input keeps the other letters as letters", () => {
  const locked = state({ isEditable: true, isRunning: true });
  for (const key of ["c", "r", "f", "s"]) {
    assert.equal(detailKeyAction(press({ key }), locked), null);
  }
});

test("a held, composing, or chorded key belongs to the browser", () => {
  assert.equal(detailKeyAction(press({ repeat: true }), state()), null);
  assert.equal(detailKeyAction(press({ isComposing: true }), state()), null);
  assert.equal(detailKeyAction(press({ keyCode: 229 }), state()), null);
  assert.equal(detailKeyAction(press({ ctrlKey: true }), state()), null);
  assert.equal(detailKeyAction(press({ metaKey: true }), state()), null);
  assert.equal(detailKeyAction(press({ altKey: true }), state()), null);
});

test("unknown keys and malformed input are ignored", () => {
  assert.equal(detailKeyAction(press({ key: "x" }), state()), null);
  assert.equal(detailKeyAction(press({ key: "Enter" }), state()), null);
  assert.equal(detailKeyAction(null, state()), null);
  assert.equal(detailKeyAction(press(), null), null);
});
