import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_ENTRY_LIMIT,
  ACCESS_STORAGE_KEY,
  createAccessStore,
} from "../src/modules/sessions/access.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

test("records the newest observation and ignores older ones", () => {
  const storage = new MemoryStorage();
  const store = createAccessStore(storage);
  store.record("s1", 100);
  store.record("s1", 200);
  store.record("s1", 150);
  assert.equal(store.getSnapshot().get("s1"), 200);

  const reloaded = createAccessStore(storage);
  assert.equal(reloaded.getSnapshot().get("s1"), 200);
});

test("drops invalid ids and timestamps", () => {
  const store = createAccessStore(new MemoryStorage());
  store.record("", 100);
  store.record("s1", Number.NaN);
  store.record("s1", 0);
  store.record("s1", -5);
  assert.equal(store.getSnapshot().size, 0);
});

test("keeps only the newest entries", () => {
  const store = createAccessStore(new MemoryStorage());
  for (let index = 0; index < ACCESS_ENTRY_LIMIT + 3; index += 1) {
    store.record(`s${index}`, index + 1);
  }
  const times = store.getSnapshot();
  assert.equal(times.size, ACCESS_ENTRY_LIMIT);
  assert.equal(times.has("s0"), false);
  assert.equal(times.has("s1"), false);
  assert.equal(times.has("s2"), false);
  assert.equal(times.get(`s${ACCESS_ENTRY_LIMIT + 2}`), ACCESS_ENTRY_LIMIT + 3);
});

test("corrupt or foreign storage falls back to an empty map", () => {
  const storage = new MemoryStorage();
  storage.setItem(ACCESS_STORAGE_KEY, "{not json");
  assert.equal(createAccessStore(storage).getSnapshot().size, 0);

  storage.setItem(ACCESS_STORAGE_KEY, "[]");
  assert.equal(createAccessStore(storage).getSnapshot().size, 0);

  storage.setItem(ACCESS_STORAGE_KEY, JSON.stringify({ s1: "x", s2: 5 }));
  const times = createAccessStore(storage).getSnapshot();
  assert.equal(times.has("s1"), false);
  assert.equal(times.get("s2"), 5);
});

test("two stores sharing one storage keep each other's visits", () => {
  const storage = new MemoryStorage();
  const first = createAccessStore(storage);
  const second = createAccessStore(storage);
  first.record("a", 100);
  second.record("b", 200);
  second.record("a", 50);
  const reloaded = createAccessStore(storage);
  assert.equal(reloaded.getSnapshot().get("a"), 100);
  assert.equal(reloaded.getSnapshot().get("b"), 200);
});

test("a denied storage keeps the in-memory map working", () => {
  const storage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  const store = createAccessStore(storage);
  store.record("s1", 100);
  assert.equal(store.getSnapshot().get("s1"), 100);
});

