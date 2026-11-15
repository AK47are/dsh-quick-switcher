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
 *
 * The open snapshot also carries the seed query and its generation: the dialog
 * starts in history mode when a command seeds "!", and a command fired while
 * the panel is already open reseeds it in place.
 */
export function QuickSwitcher({
  store,
  history,
  ask,
  uiWorkspace,
  shortcuts,
  files,
  layout,
  panels,
  recent,
  t,
  useSessions,
  useWorkspaces,
  useSessionStatus,
  usePanelInfo,
}) {
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const retainedId = useSessions((list) => retainedSessionId(list));
  const isPanelActive = usePanelInfo((info) => info.activePanelId !== null);

  React.useEffect(() => {
    if (isPanelActive || retainedId === null) return;
    getAccessStore().record(retainedId, Date.now());
  }, [retainedId, isPanelActive]);

  return state.open
    ? h(QuickSwitcherDialog, {
        store,
        history,
        ask,
        seed: state.seed,
        generation: state.generation,
        uiWorkspace,
        shortcuts,
        files,
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
