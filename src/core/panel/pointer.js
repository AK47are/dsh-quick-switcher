/* Real pointer position and the gate that tells it apart from layout replays. */

/**
 * A tracker for the last pointer position the page actually observed.
 *
 * Browsers dispatch a hover event for whatever element appears under a
 * stationary pointer, so a panel that opens (or a list that reflows) under the
 * pointer would treat that synthetic event as input. Remembering the last real
 * position lets the panel compare candidate events against it and ignore the
 * ones that repeat a position the pointer already had.
 *
 * `start` accepts its event target instead of reading `document` so tests can
 * drive a fake target; the plugin passes the real document.
 */
export function createPointerBaseline() {
  let x = null;
  let y = null;
  return {
    start(target) {
      const onPointerMove = (event) => {
        x = event.clientX;
        y = event.clientY;
      };
      target.addEventListener("pointermove", onPointerMove, { passive: true });
      return () => target.removeEventListener("pointermove", onPointerMove);
    },
    getSnapshot() {
      return x === null ? null : { x, y };
    },
  };
}

/**
 * A gate that opens only for pointer positions other than the last one it
 * accepted.
 *
 * The seed is the position recorded before the panel opened; the hover event
 * the browser replays at open repeats that position and is therefore rejected.
 * Without a seed the first event can only establish the baseline, because
 * accepting it would reopen the same bug on a page whose pointer has not moved
 * since load.
 */
export function createPointerGate(seed) {
  let last = seed === null || seed === undefined ? null : { x: seed.x, y: seed.y };
  return {
    accept(x, y) {
      if (last === null) {
        last = { x, y };
        return false;
      }
      if (last.x === x && last.y === y) return false;
      last = { x, y };
      return true;
    },
  };
}

// One baseline for the whole page: the pointer position is a page fact, not a
// panel state, so the plugin starts tracking at apply time and the panel only
// reads it when it opens.
const baseline = createPointerBaseline();

/** Start recording real pointer positions; returns the cleanup function. */
export function startPointerBaseline(target) {
  return baseline.start(target);
}

/** The latest recorded position, or null when the pointer has not moved yet. */
export function getPointerBaseline() {
  return baseline.getSnapshot();
}
