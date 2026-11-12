/* Overlay wrapper that mounts the dialog only while the store is open. */

import React from "react";
import { QuickSwitcherDialog } from "./dialog.js";

const h = React.createElement;

export function QuickSwitcher({
  store,
  uiWorkspace,
  shortcuts,
  recent,
  t,
  useSessions,
  useWorkspaces,
  useSessionStatus,
  usePanelInfo,
}) {
  const open = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return open
    ? h(QuickSwitcherDialog, {
        store,
        uiWorkspace,
        shortcuts,
        recent,
        t,
        useSessions,
        useWorkspaces,
        useSessionStatus,
        usePanelInfo,
      })
    : null;
}
