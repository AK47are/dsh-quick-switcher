/**
 * Per-browser preferences for the side question. The settings page owns the
 * switch; the ask store reads the published snapshot when a question is sent,
 * so a change applies to the next question without rebuilding the panel.
 */

const STORAGE_KEY = "dsh.quick-switcher.v1";
const DEFAULTS = Object.freeze({ includeAttachments: true });

/**
 * Read the persisted snapshot. A malformed or unavailable document falls back
 * to the defaults instead of disabling attachments.
 * @param {Storage | undefined} storage
 * @returns {{ includeAttachments: boolean }}
 */
export function readPreferences(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { includeAttachments: parsed?.includeAttachments !== false };
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
    this.#snapshot = { includeAttachments: value === true };
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#snapshot));
    } catch {
      // A blocked or full localStorage still lets the choice apply this session.
    }
    this.#emit();
  }

  dispose() {
    this.#eventTarget?.removeEventListener?.("storage", this.#onStorage);
    this.#listeners.clear();
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
