import assert from "node:assert/strict";
import test from "node:test";
import { retainedSessionId } from "../src/core/panel/displayed-session.js";

test("the first retained row is the displayed session", () => {
  const list = {
    byId: {
      a: { id: "a", retainedBy: { mainView: 0 } },
      b: { id: "b", retainedBy: { mainView: 2 } },
      c: { id: "c", retainedBy: { mainView: 1 } },
    },
  };
  assert.equal(retainedSessionId(list), "b");
});

test("an empty or malformed snapshot has no displayed session", () => {
  assert.equal(retainedSessionId({ byId: {} }), null);
  assert.equal(retainedSessionId({}), null);
  assert.equal(retainedSessionId(null), null);
  assert.equal(retainedSessionId(undefined), null);
});

test("a row without an id is skipped instead of returning undefined", () => {
  const list = { byId: { a: { retainedBy: { mainView: 1 } } } };
  assert.equal(retainedSessionId(list), null);
});
