/**
 * Open state shared by the global commands and the overlay entry.
 *
 * The command and the slot are installed on the same plugin context, so a
 * tiny external store is simpler than a Cordis service and keeps both
 * consumers in sync without React context plumbing.
 *
 * A snapshot carries the query the panel should start with: the history
 * command opens directly in history mode by seeding "!", while the search
 * command seeds an empty query. `generation` changes on every open request, so
 * a command running while the panel is already open can reseed the query
 * without remounting the dialog.
 *
 * `prefix` is the route prefix the open panel is actually showing. The dialog
 * republishes it on every query change, so a command decides from the current
 * mode rather than from the seed the panel opened with.
 */
const PREFIXES = ["!", ">", "+"];

/** The route prefix a seed query would claim. */
function seedPrefix(seed) {
  return seed !== "" && PREFIXES.includes(seed[0]) ? seed[0] : "";
}

export function createOpenStore() {
  let state = {
    open: false,
    seed: "",
    prefix: "",
    generation: 0,
  };
  const listeners = new Set();
  const publish = (next) => {
    if (
      state.open === next.open &&
      state.seed === next.seed &&
      state.prefix === next.prefix &&
      state.generation === next.generation
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const open = (seed = "") =>
    publish({
      open: true,
      seed,
      prefix: seedPrefix(seed),
      generation: state.generation + 1,
    });
  const close = () => {
    if (!state.open) return;
    publish({
      open: false,
      seed: "",
      prefix: "",
      generation: state.generation + 1,
    });
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    close,
    toggle: () => (state.open ? close() : open("")),
    /**
     * Tell the store which mode the panel now shows. The dialog calls this
     * after each query change, so deleting the seed prefix really moves the
     * panel back to search for the next command request.
     */
    setPrefix(prefix) {
      if (!state.open || state.prefix === prefix) return;
      publish({ ...state, prefix });
    },
    /**
     * The history command's entry point. Pressing it again while the panel is
     * already in history mode closes it; from any other mode it reseeds the
     * same panel instead of closing and losing the open surface.
     */
    requestHistory: () =>
      state.open && state.prefix === "!" ? close() : open("!"),
  };
}
