/**
 * Open state shared by the overlay, the commands and the public service.
 *
 * A snapshot carries the seed the panel should start with and a generation that
 * changes on every open request, so a command fired while the panel is already
 * open reseeds the query in place instead of remounting the surface. `mode` is
 * the matcher id the shell resolved on the last render; commands read it to
 * decide whether the panel is already in their mode.
 */

export function createPanelController() {
  let state = Object.freeze({ open: false, seed: "", generation: 0, mode: null, query: "" });
  const listeners = new Set();
  let disposed = false;

  function publish(next) {
    if (
      state.open === next.open &&
      state.seed === next.seed &&
      state.generation === next.generation &&
      state.mode === next.mode &&
      state.query === next.query
    ) {
      return;
    }
    state = Object.freeze(next);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] panel listener failed", error);
      }
    }
  }

  function open(options = {}) {
    if (disposed) return;
    const seed = typeof options.seed === "string" ? options.seed : "";
    publish({
      open: true,
      seed,
      generation: state.generation + 1,
      mode: null,
      query: seed,
    });
  }

  function close() {
    if (disposed || !state.open) return;
    publish({
      open: false,
      seed: "",
      generation: state.generation + 1,
      mode: null,
      query: "",
    });
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function setMode(mode) {
    if (disposed || !state.open) return;
    const next = typeof mode === "string" && mode !== "" ? mode : null;
    if (state.mode === next) return;
    publish({ ...state, mode: next });
  }

  function setQuery(query) {
    if (disposed || !state.open) return;
    const next = typeof query === "string" ? query : "";
    if (state.query === next) return;
    publish({ ...state, query: next });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose() {
    disposed = true;
    listeners.clear();
  }

  return {
    getState: () => state,
    isOpen: () => state.open,
    subscribe,
    open,
    close,
    toggle,
    setMode,
    setQuery,
    dispose,
  };
}
