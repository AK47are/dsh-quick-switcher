/* Session-scoped bridge that feeds the root panel and performs its writes. */

import React from "react";
import { collectPrompts } from "./logic.js";

/**
 * The history bridge.
 *
 * It renders nothing. Its only job is to sit in the composer's overlay slot,
 * where DSH exposes the session hooks the root overlay lacks: `useChat` for the
 * loaded window, `useInput` for the draft and phase, `useSession` for pagination
 * flags, and `inputActions` for the write-back. Everything it observes is
 * published to the module store; the panel reads that store and asks it for the
 * two writes.
 *
 * The write callbacks are read through a ref because the slot host may hand
 * over fresh function identities on every render; re-running `attach` for a new
 * identity would briefly detach the session and clear the panel under itself.
 */
export function HistoryBridge({
  sessionId,
  historyStore,
  loadOlder,
  useChat,
  useInput,
  useSession,
  inputActions,
}) {
  const order = useChat((state) => state.order);
  const nodes = useChat((state) => state.nodes);
  const draft = useInput((state) => state?.draft ?? "");
  const phase = useInput((state) => state?.phase ?? "plain");
  const hasMore = useSession((state) => state?.hasMore === true);
  const loadingOlder = useSession((state) => state?.loadingOlder === true);

  const prompts = React.useMemo(() => collectPrompts(order, nodes), [order, nodes]);

  const latest = React.useRef(null);
  latest.current = { sessionId, inputActions, loadOlder };

  React.useEffect(() => {
    historyStore.attach(sessionId, {
      setDraft: (text) => {
        latest.current.inputActions.setDraft(text);
      },
      loadOlder: () => latest.current.loadOlder(latest.current.sessionId),
    });
    return () => historyStore.detach(sessionId);
  }, [historyStore, sessionId]);

  React.useEffect(() => {
    historyStore.publish({ sessionId, prompts, draft, phase, hasMore, loadingOlder });
  }, [historyStore, sessionId, prompts, draft, phase, hasMore, loadingOlder]);

  return null;
}
