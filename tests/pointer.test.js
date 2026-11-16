import assert from "node:assert/strict";
import test from "node:test";
import {
  createPointerBaseline,
  createPointerGate,
  getPointerBaseline,
  startPointerBaseline,
} from "../src/core/panel/pointer.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type, event) {
    const listener = this.listeners.get(type);
    if (listener) listener(event);
  }
}

test("a replayed hover at the opening position is not movement", () => {
  const gate = createPointerGate({ x: 100, y: 200 });
  assert.equal(gate.accept(100, 200), false);
  assert.equal(gate.accept(100, 200), false);
});

test("a changed position opens the gate, repeats stay closed", () => {
  const gate = createPointerGate({ x: 100, y: 200 });
  assert.equal(gate.accept(101, 200), true);
  assert.equal(gate.accept(101, 200), false);
  assert.equal(gate.accept(101, 201), true);
});

test("without a seed the first event only sets the baseline", () => {
  const gate = createPointerGate(null);
  assert.equal(gate.accept(40, 50), false);
  assert.equal(gate.accept(40, 50), false);
  assert.equal(gate.accept(41, 50), true);
});

test("each open is seeded from the position reached while closed", () => {
  const target = new FakeTarget();
  const baseline = createPointerBaseline();
  const stop = baseline.start(target);

  target.dispatch("pointermove", { clientX: 10, clientY: 20 });
  const first = createPointerGate(baseline.getSnapshot());
  assert.equal(first.accept(10, 20), false);

  target.dispatch("pointermove", { clientX: 30, clientY: 40 });
  const second = createPointerGate(baseline.getSnapshot());
  assert.equal(second.accept(30, 40), false);
  assert.equal(second.accept(31, 40), true);
  stop();
});

test("the baseline stops recording once disposed", () => {
  const target = new FakeTarget();
  const stop = startPointerBaseline(target);
  target.dispatch("pointermove", { clientX: 5, clientY: 6 });
  assert.deepEqual(getPointerBaseline(), { x: 5, y: 6 });
  stop();
  target.dispatch("pointermove", { clientX: 7, clientY: 8 });
  assert.deepEqual(getPointerBaseline(), { x: 5, y: 6 });
});

