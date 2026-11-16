/**
 * Per-browser preferences for the switcher. The settings page owns the
 * controls; the ask store reads the published snapshot when a question is sent
 * and the panel reads it when it opens, so a change applies without rebuilding
 * the open overlay.
 */

import { pendingOrderOf } from "./data/pending-order.js";

const STORAGE_KEY = "dsh.quick-switcher.v1";
const DEFAULTS = Object.freeze({
  includeAttachments: true,
  pendingOrder: pendingOrderOf(undefined),
});

/**
 * Read the persisted snapshot. A malformed or unavailable document falls back
 * to the defaults; a field an older version wrote without falls back on its own,
 * so adding a preference never resets the others.
 * @param {Storage | undefined} storage
 * @returns {{ includeAttachments: boolean, pendingOrder: string }}
 */
export function readPreferences(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      includeAttachments: parsed?.includeAttachments !== false,
      pendingOrder: pendingOrderOf(parsed?.pendingOrder),
    };
  } catch {
    return DEFAULTS;
  }
}

export class PreferencesStore {
  #storage;
  #eventTarget;
  #snapshot;
  #listeners = new Set();
  #onStorage = (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    this.#snapshot = readPreferences(this.#storage);
    this.#emit();
  };

  /**
   * @param {{ storage?: Storage, eventTarget?: EventTarget }} [options]
   */
  constructor({ storage, eventTarget = globalThis } = {}) {
    this.#storage = storage ?? safeLocalStorage();
    this.#eventTarget = eventTarget;
    this.#snapshot = readPreferences(this.#storage);
    this.#eventTarget?.addEventListener?.("storage", this.#onStorage);
  }

  subscribe = (listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = () => this.#snapshot;

  /** Persist and publish the attachment preference. */
  setIncludeAttachments(value) {
    this.#write({ includeAttachments: value === true });
  }

  /** Persist and publish the pending group's order. */
  setPendingOrder(value) {
    this.#write({ pendingOrder: pendingOrderOf(value) });
  }

  dispose() {
    this.#eventTarget?.removeEventListener?.("storage", this.#onStorage);
    this.#listeners.clear();
  }

  #write(patch) {
    // Merge instead of replacing: each setter owns one field, and rebuilding
    // the snapshot here would silently drop the preference it does not touch.
    this.#snapshot = { ...this.#snapshot, ...patch };
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#snapshot));
    } catch {
      // A blocked or full localStorage still lets the choice apply this session.
    }
    this.#emit();
  }

  #emit() {
    for (const listener of [...this.#listeners]) listener();
  }
}

function safeLocalStorage() {
  try {
    if (typeof window === "undefined") return undefined;
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const preferences = new PreferencesStore();
export { DEFAULTS, STORAGE_KEY };
