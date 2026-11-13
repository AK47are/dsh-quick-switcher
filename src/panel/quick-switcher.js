/* Overlay wrapper that mounts the dialog only while the store is open. */

import React from "react";
import { getAccessStore } from "../data/access.js";
import { retainedSessionId } from "../data/sessions.js";
import { QuickSwitcherDialog } from "./dialog.js";

const h = React.createElement;

/**
 * The overlay slot component.
 *
 * It stays mounted while the panel is closed, which makes it the only place
 * that can observe every session the main view shows, including switches
 * made from the sidebar. Those observations are recorded as access times and
 * read back when the panel opens; recording pauses while a main panel covers
 * the conversation, because opening a panel is not a visit to the session
 * hidden behind it.
 */
export function QuickSwitcher({
  store,
  uiWorkspace,
  shortcuts,
  layout,
  panels,
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
  const retainedId = useSessions((state) => retainedSessionId(state));
  const isPanelActive = usePanelInfo((info) => info.activePanelId !== null);

  React.useEffect(() => {
    if (isPanelActive || retainedId === null) return;
    getAccessStore().record(retainedId, Date.now());
  }, [retainedId, isPanelActive]);

  return open
    ? h(QuickSwitcherDialog, {
        store,
        uiWorkspace,
        shortcuts,
        layout,
        panels,
        recent,
        t,
        useSessions,
        useWorkspaces,
        useSessionStatus,
        usePanelInfo,
      })
    : null;
}
