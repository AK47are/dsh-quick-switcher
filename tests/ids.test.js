import assert from "node:assert/strict";
import test from "node:test";
import {
  ID_PREFIX_MIN,
  SHORT_ID_LENGTH,
  idKeyOf,
  shortIdOf,
} from "../src/core/lib/ids.js";

test("the key drops the session prefix, the hyphens, and the case", () => {
  assert.equal(idKeyOf("session-63CB1FD1-27b3-4b86"), "63cb1fd127b34b86");
  assert.equal(idKeyOf("63cb1fd1-27b3"), "63cb1fd127b3");
  assert.equal(idKeyOf("  session-63cb1fd1  "), "63cb1fd1");
  assert.equal(idKeyOf(""), "");
  assert.equal(idKeyOf(undefined), "");
});

test("the prefixed id and the bare uuid share one key", () => {
  const uuid = "63cb1fd1-27b3-4b86-9f99-1fc7d8937ffa";
  assert.equal(idKeyOf(`session-${uuid}`), idKeyOf(uuid));
});

test("the short code is the first eight key characters", () => {
  assert.equal(SHORT_ID_LENGTH, 8);
  assert.equal(shortIdOf("session-63cb1fd1-27b3-4b86-9f99-1fc7d8937ffa"), "63cb1fd1");
  assert.equal(shortIdOf("63cb1fd127b3"), "63cb1fd1");
  assert.equal(shortIdOf("abcdefghijkl"), "abcdefgh");
  assert.equal(shortIdOf("main"), "main");
});

test("an id too short to search gets no short code", () => {
  assert.equal(ID_PREFIX_MIN, 4);
  assert.equal(shortIdOf("abc"), "");
  assert.equal(shortIdOf("session-1"), "");
  assert.equal(shortIdOf(""), "");
  assert.equal(shortIdOf(undefined), "");
});

