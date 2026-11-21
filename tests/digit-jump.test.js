import assert from "node:assert/strict";
import test from "node:test";
import { digitRowIndex, jumpKeys } from "../src/core/panel/digit-jump.js";

/** A keyboard event shape carrying only the fields the helper reads. */
function press(overrides = {}) {
  return {
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    code: "Digit1",
    key: "1",
    ...overrides,
  };
}

test("Alt plus the top number row targets rows one through nine", () => {
  for (let digit = 1; digit <= 9; digit += 1) {
    const event = press({ code: `Digit${digit}`, key: String(digit) });
    assert.equal(digitRowIndex(event), digit - 1);
  }
});

test("a digit without Alt never targets a row", () => {
  assert.equal(digitRowIndex(press({ altKey: false })), null);
});

test("Ctrl or Meta keeps the combination for the browser and AltGr input", () => {
  assert.equal(digitRowIndex(press({ ctrlKey: true })), null);
  assert.equal(digitRowIndex(press({ metaKey: true })), null);
});

test("zero and the numpad are not row targets", () => {
  assert.equal(digitRowIndex(press({ code: "Digit0", key: "0" })), null);
  assert.equal(digitRowIndex(press({ code: "Numpad1", key: "1" })), null);
});

test("the physical code wins over a layout specific key", () => {
  assert.equal(digitRowIndex(press({ code: "Digit1", key: "¡" })), 0);
  assert.equal(digitRowIndex(press({ code: "Digit1", key: "&" })), 0);
});

test("the key value is only a fallback when no code is reported", () => {
  assert.equal(digitRowIndex(press({ code: "", key: "7" })), 6);
  assert.equal(digitRowIndex(press({ code: "", key: "7", altKey: false })), null);
  assert.equal(digitRowIndex(press({ code: "", key: "x" })), null);
});

test("a missing or malformed event is ignored", () => {
  assert.equal(digitRowIndex(null), null);
  assert.equal(digitRowIndex(undefined), null);
  assert.equal(digitRowIndex("Alt+1"), null);
});

test("the jump hint uses the same platform labels as bound shortcuts", () => {
  assert.deepEqual(jumpKeys("windows", 1), ["Alt", "+", "1"]);
  assert.deepEqual(jumpKeys("macos", 1), ["⌥", "1"]);
  assert.deepEqual(jumpKeys("linux", 1), ["Alt", "1"]);
  assert.deepEqual(jumpKeys("windows", 9), ["Alt", "+", "9"]);
});

test("an unknown platform keeps the plain Alt hint", () => {
  assert.deepEqual(jumpKeys(undefined, 2), ["Alt", "2"]);
  assert.deepEqual(jumpKeys("plan9", 2), ["Alt", "2"]);
});

