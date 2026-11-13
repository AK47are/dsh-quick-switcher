/* Shared state between the session-scoped bridge and the global panel. */

import { isInputFrozen } from "./data/history.js";

/**
 * The panel lives in the root overlay slot, which carries no session hooks,
 * while the prompt window and the input actions only exist inside a session.
 * The bridge mounted in `conversation.input.overlay` publishes what it observes
 * here and registers the two writes the panel needs; the panel never reaches
 * into a conversation binding itself.
 */

/** Data every consumer sees when no session is displayed. */
const EMPTY = Object.freeze({
  sessionId: null,
  prompts: Object.freeze([]),
  draft: "",
  phase: "plain",
  hasMore: false,
  loadingOlder: false,
});

/** Whether a new prompt array describes the same messages as the old one. */
function samePrompts(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].key !== right[index].key) return false;
  }
  return true;
}

/**
 * Compare snapshots field by field.
 *
 * Consumers read through `useSyncExternalStore`, so returning a fresh object
 * for an unchanged chat publish would re-render the panel on every streaming
 * token. Arrays are compared by their message keys because a prompt's text is
 * immutable once its seq exists.
 */
function sameSnapshot(left, right) {
  if (left.sessionId !== right.sessionId) return false;
  if (!samePrompts(left.prompts, right.prompts)) return false;
  return (
    left.draft === right.draft &&
    left.phase === right.phase &&
    left.hasMore === right.hasMore &&
    left.loadingOlder === right.loadingOlder
  );
}

/**
 * Create the history store shared by the bridge and the panel.
 *
 * `publish` merges the bridge's observation, `attach`/`detach` manage the two
 * write paths, and `apply` refuses while the input is frozen so the panel does
 * not have to duplicate the phase rules. Writes are delegated instead of
 * reaching into DSH from here, which keeps this module testable without a
 * browser.
 */
export function createHistoryStore() {
  let snapshot = EMPTY;
  let handlers = null;
  const listeners = new Set();

  const publish = (next) => {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Publish one observation from the bridge.
     *
     * Replacing the prompt array only when its message keys changed keeps a
     * draft keystroke from rebuilding the list.
     */
    publish(patch) {
      const next = { ...snapshot, ...patch };
      if (samePrompts(snapshot.prompts, next.prompts)) next.prompts = snapshot.prompts;
      publish(next);
    },

    /** Register the session whose writes the panel may perform. */
    attach(sessionId, write) {
      handlers = { sessionId, ...write };
      if (snapshot.sessionId !== sessionId) {
        publish({
          ...EMPTY,
          sessionId,
        });
      }
    },

    /** Forget a session only when the bridge leaving is still the attached one. */
    detach(sessionId) {
      if (handlers === null || handlers.sessionId !== sessionId) return;
      handlers = null;
      publish(EMPTY);
    },

    /** Whether the panel can open for a session at all. */
    hasSession() {
      return snapshot.sessionId !== null;
    },

    /**
     * Replace the whole draft.
     *
     * Returns false when no bridge is mounted or the input is frozen, so the
     * panel can explain the refusal instead of closing silently.
     */
    apply(text) {
      if (typeof text !== "string" || text === "") return false;
      if (handlers === null) return false;
      if (isInputFrozen(snapshot.phase)) return false;
      try {
        handlers.setDraft(text);
        return true;
      } catch {
        return false;
      }
    },

    /** Pull one older page; the bridge republishes the window when it lands. */
    loadOlder() {
      if (handlers === null) return Promise.reject(new Error("no session"));
      try {
        return Promise.resolve(handlers.loadOlder());
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
