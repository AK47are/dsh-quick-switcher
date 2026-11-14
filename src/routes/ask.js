/* "?" route: ask the current session a side question and read its answer. */

import { buildPendingContext } from "../ask-context.js";
import { statusLabelKey } from "../ask-store.js";
import { relativeTime } from "../data/format.js";

/**
 * The side-question route.
 *
 * The query text after `?` is the question, never a filter: a side question is
 * one sentence the user wants answered, and matching history against it would
 * only ever hide the row they need. `?` alone lists the current session's
 * records, which is also where a half-finished answer can be reopened.
 *
 * The route owns one piece of navigation state, `detailId`. It survives a
 * query change so a stream that lands while the detail is open keeps updating
 * in place, and it is cleared by `back` rather than by the panel: the shell
 * only renders what the view returns.
 *
 * The record component lives in the panel; this route returns a descriptor
 * (`content`/`footer`) so routes stay free of React and the unit tests can
 * import this file with plain Node.
 */
export function createAskRoute({ notify, store } = {}) {
  let detailId = null;
  /** Last non-null current session, used to abort its request on close. */
  let sessionId = null;

  const refresh = () => {
    notify?.();
  };
  const unsubscribe = store?.subscribe?.(refresh);

  function entriesOf(id) {
    if (id === null) return [];
    return store?.entriesOf?.(id) ?? [];
  }

  function find(id) {
    return store?.find?.(id) ?? null;
  }

  /**
   * One history row. The badge only appears for states that need a word:
   * a finished answer is the normal case.
   */
  function historyRow(record, ctx) {
    const { t, now } = ctx;
    const time = relativeTime(record.startedAt, t, now);
    const labelKey = statusLabelKey(record);
    return {
      key: `a:h:${record.id}`,
      title: record.question,
      meta: time === "" ? [] : [{ text: time, className: "dqs-time" }],
      badge: labelKey === null ? null : t(labelKey),
      className: "dqs-ask-row",
      run: () => {
        detailId = record.id;
        refresh();
        return { type: "query", query: `?${record.question}` };
      },
    };
  }

  function detailView(record, ctx) {
    const { t } = ctx;
    return {
      placeholder: t("placeholderAsk"),
      searchAria: t("searchAriaAsk"),
      listLabel: t("listLabelAsk"),
      rows: [],
      // A detail view is not an empty list: the panel renders the component
      // instead of the listbox, and an empty `rows` array keeps every other
      // consumer of the view shape honest.
      content: { kind: "ask", id: record.id },
      footer: { kind: "ask", id: record.id },
      inputLocked: true,
      back: () => {
        detailId = null;
        refresh();
      },
      hints: [],
      count: "",
    };
  }

  return {
    id: "ask",
    prefix: "?",

    parse(query) {
      if (!query.startsWith("?")) return null;
      return { text: query.slice(1) };
    },

    view(parsed, ctx) {
      const { t, currentId, pending } = ctx;
      if (typeof currentId === "string" && currentId !== "") sessionId = currentId;

      // A record can disappear only through the session cap; drop the detail
      // instead of rendering a header that points at nothing.
      const detail = detailId === null ? null : find(detailId);
      if (detailId !== null && detail === null) detailId = null;
      if (detail !== null) return detailView(detail, ctx);

      const entries = entriesOf(currentId);
      const running = entries.some((entry) => entry.status === "running");
      const text = parsed.text.trim();
      const rows = [];

      // The ask row is only honest when there is a session to ask in and a
      // question to send. It carries no `action` flag so typing keeps it as
      // the default row.
      if (text !== "" && currentId !== null) {
        rows.push({
          key: "a:q",
          title: t("askRow", { question: text }),
          meta: running ? [{ text: t("askBusy") }] : [],
          className: "dqs-ask-row",
          run: running
            ? undefined
            : () => {
                const record = store?.ask?.(
                  currentId,
                  text,
                  buildPendingContext(pending, t, currentId),
                );
                if (record === null || record === undefined) return undefined;
                detailId = record.id;
                // The store already announced the new record; this second
                // request makes the detail render even if that announcement is
                // ever flushed before `detailId` was assigned.
                refresh();
                return { type: "query", query: `?${text}` };
              },
        });
      }
      for (const record of entries) rows.push(historyRow(record, ctx));

      let emptyText = null;
      if (currentId === null) emptyText = t("askNoSession");
      else if (rows.length === 0) emptyText = t("emptyAsk");

      // With no text typed the running request is invisible otherwise: the
      // list just looks like it has no way to ask anything.
      const note = running && text === "" ? t("askRunningNote") : null;

      const hints = [];
      if (text !== "") hints.push({ keys: ["Enter"], label: t("hintAskSend") });
      else if (entries.length > 0) hints.push({ keys: ["Enter"], label: t("hintAskView") });
      hints.push({ keys: ["Esc"], label: t("hintClose") });

      return {
        placeholder: t("placeholderAsk"),
        searchAria: t("searchAriaAsk"),
        listLabel: t("listLabelAsk"),
        rows,
        emptyText,
        note,
        hints,
        count: t("countAsk", { count: entries.length }),
      };
    },

    /**
     * Closing the panel aborts the session's running answer but keeps what was
     * already received. The record is marked stopped by the store, so the next
     * visit can still read the half answer and regenerate it.
     */
    dispose() {
      unsubscribe?.();
      if (sessionId !== null) store?.abortSession?.(sessionId);
    },
  };
}
