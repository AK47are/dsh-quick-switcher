/* Always-on session observer: projects the lists and publishes them for other modules. */

import React from "react";
import { retainedSessionId } from "../../core/panel/displayed-session.js";
import { projectSessionData } from "./projection.js";

/**
 * The overlay slot component that owns session data.
 *
 * The panel itself cannot read DSH's session hooks, so this component stays
 * mounted in the same overlay slot and publishes one snapshot into the shared
 * `session-data` store. It also records the access time of the conversation the
 * main view shows; that recording is why it has to run while the panel is
 * closed. Both the default list and the workspace scope read the snapshot.
 */
export function createSessionsPresenter({ api, shared, access, rowFor }) {
  return function SessionsPresenter({
    useSessions,
    useWorkspaces,
    useSessionStatus,
    usePanelInfo,
  }) {
    const sessionList = useSessions((value) => value);
    const workspaceList = useWorkspaces((value) => value);
    const statuses = useSessionStatus((value) => value);
    const activePanelId = usePanelInfo((info) => info.activePanelId);
    const retainedId = retainedSessionId(sessionList);

    // A settings change must rebuild the pending order without reopening the
    // panel; the subscription only bumps a revision so the projection reruns.
    const [revision, setRevision] = React.useState(0);
    React.useEffect(
      () => api.settings.subscribe(() => setRevision((value) => value + 1)),
      [],
    );

    React.useEffect(() => {
      if (activePanelId !== null || retainedId === null) return;
      access.record(retainedId, Date.now());
    }, [retainedId, activePanelId, access]);

    const data = React.useMemo(
      () =>
        projectSessionData({
          sessionList,
          workspaceList,
          statuses,
          activePanelId,
          accessTimes: access.getSnapshot(),
          pendingOrder: api.settings.get("pendingOrder"),
        }),
      [sessionList, workspaceList, statuses, activePanelId, revision],
    );

    React.useEffect(() => {
      shared.publish({ ...data, rowFor });
    }, [data, shared, rowFor]);

    // Switching the sessions module off removes this slot, which unsubscribes
    // the only publisher of `session-data`. Clear the last snapshot so the
    // workspace module shows an empty list instead of rows that stopped
    // updating; the same cleanup runs when the plugin unloads.
    React.useEffect(
      () => () => {
        shared.publish(null);
      },
      [shared],
    );

    return null;
  };
}
