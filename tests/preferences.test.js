import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULTS,
  PreferencesStore,
  STORAGE_KEY,
  readPreferences,
} from "../src/preferences.js";

/** Minimal Storage stand-in; the store only reads and writes one key. */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("both preferences default and malformed storage falls back", () => {
  const defaults = { includeAttachments: true, pendingOrder: "least-recent" };
  assert.deepEqual(readPreferences(undefined), defaults);
  assert.deepEqual(readPreferences(memoryStorage()), defaults);
  assert.deepEqual(
    readPreferences(memoryStorage({ [STORAGE_KEY]: "not json" })),
    defaults,
  );
  assert.deepEqual(
    readPreferences(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ includeAttachments: false }) })),
    { includeAttachments: false, pendingOrder: "least-recent" },
  );
});

test("an unknown pending order falls back to the default", () => {
  const stored = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({ pendingOrder: "sideways" }),
  });
  assert.equal(readPreferences(stored).pendingOrder, DEFAULTS.pendingOrder);
});

test("each setter keeps the preference it does not own", () => {
  const storage = memoryStorage();
  const store = new PreferencesStore({ storage, eventTarget: new EventTarget() });

  store.setPendingOrder("most-recent");
  store.setIncludeAttachments(false);
  assert.deepEqual(readPreferences(storage), {
    includeAttachments: false,
    pendingOrder: "most-recent",
  });

  store.setPendingOrder("least-recent");
  assert.deepEqual(readPreferences(storage), {
    includeAttachments: false,
    pendingOrder: "least-recent",
  });
});

test("the store persists and publishes a preference change", () => {
  const storage = memoryStorage();
  const store = new PreferencesStore({ storage, eventTarget: new EventTarget() });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  assert.equal(store.getSnapshot().includeAttachments, DEFAULTS.includeAttachments);
  store.setPendingOrder("most-recent");

  assert.equal(store.getSnapshot().pendingOrder, "most-recent");
  assert.deepEqual(readPreferences(storage), {
    includeAttachments: true,
    pendingOrder: "most-recent",
  });
  assert.equal(notifications, 1);

  unsubscribe();
  store.setIncludeAttachments(false);
  assert.equal(notifications, 1);
  assert.deepEqual(readPreferences(storage), {
    includeAttachments: false,
    pendingOrder: "most-recent",
  });
});

test("a storage event from another tab reloads the whole snapshot", () => {
  const storage = memoryStorage();
  const target = new EventTarget();
  const store = new PreferencesStore({ storage, eventTarget: target });

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ includeAttachments: false, pendingOrder: "most-recent" }),
  );
  const event = new Event("storage");
  event.key = STORAGE_KEY;
  target.dispatchEvent(event);

  assert.deepEqual(store.getSnapshot(), {
    includeAttachments: false,
    pendingOrder: "most-recent",
  });
});

test("dispose stops following storage events", () => {
  const storage = memoryStorage();
  const target = new EventTarget();
  const store = new PreferencesStore({ storage, eventTarget: target });
  store.dispose();

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ includeAttachments: false, pendingOrder: "most-recent" }),
  );
  const event = new Event("storage");
  event.key = STORAGE_KEY;
  target.dispatchEvent(event);

  assert.deepEqual(store.getSnapshot(), DEFAULTS);
});
