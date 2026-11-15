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

test("attachments are on by default and malformed storage falls back", () => {
  assert.deepEqual(readPreferences(undefined), { includeAttachments: true });
  assert.deepEqual(readPreferences(memoryStorage()), { includeAttachments: true });
  assert.deepEqual(
    readPreferences(memoryStorage({ [STORAGE_KEY]: "not json" })),
    { includeAttachments: true },
  );
  assert.deepEqual(
    readPreferences(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ includeAttachments: false }) })),
    { includeAttachments: false },
  );
});

test("the store persists and publishes a preference change", () => {
  const storage = memoryStorage();
  const store = new PreferencesStore({ storage, eventTarget: new EventTarget() });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  assert.equal(store.getSnapshot().includeAttachments, DEFAULTS.includeAttachments);
  store.setIncludeAttachments(false);

  assert.equal(store.getSnapshot().includeAttachments, false);
  assert.deepEqual(readPreferences(storage), { includeAttachments: false });
  assert.equal(notifications, 1);

  unsubscribe();
  store.setIncludeAttachments(true);
  assert.equal(notifications, 1);
  assert.deepEqual(readPreferences(storage), { includeAttachments: true });
});

test("a storage event from another tab reloads the snapshot", () => {
  const storage = memoryStorage();
  const target = new EventTarget();
  const store = new PreferencesStore({ storage, eventTarget: target });

  storage.setItem(STORAGE_KEY, JSON.stringify({ includeAttachments: false }));
  const event = new Event("storage");
  event.key = STORAGE_KEY;
  target.dispatchEvent(event);

  assert.equal(store.getSnapshot().includeAttachments, false);
});

test("dispose stops following storage events", () => {
  const storage = memoryStorage();
  const target = new EventTarget();
  const store = new PreferencesStore({ storage, eventTarget: target });
  store.dispose();

  storage.setItem(STORAGE_KEY, JSON.stringify({ includeAttachments: false }));
  const event = new Event("storage");
  event.key = STORAGE_KEY;
  target.dispatchEvent(event);

  assert.equal(store.getSnapshot().includeAttachments, true);
});
