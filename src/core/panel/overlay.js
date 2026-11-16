/* shell.overlay entry: keep the panel unmounted until the controller opens it. */

import React from "react";
import { retainedSessionId } from "./displayed-session.js";
import { SwitcherShell } from "./shell.js";

const h = React.createElement;

/**
 * Build the root overlay component.
 *
 * The overlay stays mounted while the panel is closed because the DSH slot
 * passes its standard session hooks here; only the dialog is conditional. The
 * displayed conversation and the pending interaction are the two session facts
 * every module may need, so they are resolved once here and handed to the panel
 * context. The sessions module still owns the list, ordering and access times.
 *
 * `t` covers shared copy; `translate` resolves one module's dictionary and is
 * what a content view or its footer gets, because their keys belong to the
 * module that registered the view kind.
 */
export function createOverlay({ registry, controller, t, translate, services, get }) {
  function Overlay({ useSessions, useSessionStatus, usePanelInfo }) {
    const state = React.useSyncExternalStore(
      controller.subscribe,
      controller.getState,
      controller.getState,
    );
    const sessionList = useSessions((value) => value);
    const statuses = useSessionStatus((value) => value);
    const activePanelId = usePanelInfo((info) => info.activePanelId);

    if (!state.open) return null;

    // A main panel covers the conversation without releasing its retention, so
    // no session counts as current while one is active.
    const currentSessionId = activePanelId === null ? retainedSessionId(sessionList) : null;
    const pending =
      currentSessionId === null
        ? null
        : statuses?.get?.(currentSessionId)?.pendingInteraction ?? null;

    return h(SwitcherShell, {
      registry,
      controller,
      t,
      translate,
      services,
      get,
      currentSessionId,
      activePanelId,
      pending,
      seed: state.seed,
      generation: state.generation,
    });
  }
  return Overlay;
}
