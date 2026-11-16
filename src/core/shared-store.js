/**
 * Named stores that modules share without importing each other.
 *
 * The bus is deliberately tiny: a name resolves to one subscribable value that
 * any module may publish to or read from. It exists for the two facts one
 * module owns but another needs to render, such as the visible session entries
 * that the workspace scope lists. A module that resolves a name nobody published
 * yet gets an empty snapshot and fills in when the owner publishes, so load
 * order never has to be expressed as an import graph.
 */

export function createSharedStores() {
  const stores = new Map();
  let disposed = false;

  function store(name) {
    if (typeof name !== "string" || name === "") {
      throw new TypeError("dsh-quick-switcher: a shared store needs a non-empty name");
    }
    if (disposed) {
      throw new Error("dsh-quick-switcher: shared stores are disposed");
    }
    let entry = stores.get(name);
    if (entry === undefined) {
      entry = createEntry(name);
      stores.set(name, entry);
    }
    return entry;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of stores.values()) entry.clear();
    stores.clear();
  }

  return { store, dispose };
}

function createEntry(name) {
  let value = null;
  const listeners = new Set();

  return {
    name,
    getSnapshot: () => value,
    publish(next) {
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch (error) {
          console.error(`[dsh-quick-switcher] shared store "${name}" listener failed`, error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      value = null;
      listeners.clear();
    },
  };
}
