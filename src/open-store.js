/**
 * Open state shared by the global command and the overlay entry.
 *
 * The command and the slot are installed on the same plugin context, so a
 * tiny external store is simpler than a Cordis service and keeps both
 * consumers in sync without React context plumbing.
 */
export function createOpenStore() {
  let open = false;
  const listeners = new Set();
  const publish = (next) => {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: () => publish(true),
    close: () => publish(false),
    toggle: () => publish(!open),
  };
}
