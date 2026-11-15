/* Side-question detail key routing, kept free of React so it can be unit tested. */

/**
 * Map one keydown inside the side-question detail to the action it triggers.
 *
 * `i` takes the vim insert meaning: it hands the keyboard back to the input.
 * The quick switcher is a modal, so this panel owns the gesture. The detail
 * has exactly one input, the question field it locks while reading, and `i`
 * cannot type into a read-only field, so the gesture is read before the
 * editable rule. Backspace is deliberately absent: one action gets one key,
 * and inside a locked field Backspace shows no effect that could explain
 * itself to the user.
 *
 * The other letters stay letters while that field has focus, because the user
 * may be selecting the question to copy. A held key is dropped: returning to
 * the list focuses the input, and a repeat must not fire the action twice.
 * Composing keys and modifier chords belong to the browser and the input
 * method.
 *
 * @param event - a keydown event shape (`key`, `repeat`, `isComposing`,
 *   `keyCode`, and the three modifier flags).
 * @param state - what the current view and record allow. Every flag is read
 *   here so the caller keeps the store and the record as the single source of
 *   truth.
 * @returns {"back"|"stop"|"copy"|"regenerate"|"fork"|null}
 */
export function detailKeyAction(event, state) {
  if (event === null || typeof event !== "object") return null;
  if (state === null || typeof state !== "object") return null;
  if (event.isComposing === true || event.keyCode === 229) return null;
  if (event.repeat === true) return null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) {
    return null;
  }
  if (typeof event.key !== "string") return null;
  const key = event.key.toLowerCase();
  // The locked question field matches the editable rule, and `i` still has to
  // work there; every other letter keeps that field as a text surface.
  if (key === "i") return state.hasBack === true ? "back" : null;
  if (state.isEditable === true) return null;
  if (key === "s") return state.isRunning === true ? "stop" : null;
  if (key === "c") return state.canCopy === true ? "copy" : null;
  if (key === "r") return state.canRegenerate === true ? "regenerate" : null;
  if (key === "f") {
    return state.canFork === true && state.isForking !== true ? "fork" : null;
  }
  return null;
}
