/* "!" route: sent prompts from the current session, newest first. */

import {
  HISTORY_LIMIT,
  historyEntries,
  isInputFrozen,
  previewPrompt,
} from "../data/history.js";
import { relativeTime } from "../data/format.js";
import { filterEntries } from "../data/search.js";

/**
 * The history route projects the bridge's published window into rows and hands
 * the chosen text back as an effect. Writing to the input stays in the panel
 * because it owns the store and the notice; the route only decides which text
 * a row carries, which rows exist, and in what order.
 */
export function createHistoryRoute() {
  return {
    id: "history",
    prefix: "!",
    parse(query) {
      if (!query.startsWith("!")) return null;
      return { filter: query.slice(1) };
    },
    view(parsed, ctx) {
      const { t, now } = ctx;
      const history = ctx.history ?? {};
      const sessionId = history.sessionId ?? null;
      const prompts = Array.isArray(history.prompts) ? history.prompts : [];
      const frozen = isInputFrozen(history.phase);
      const draft = String(history.draft ?? "").trim();
      const filter = parsed.filter.trim();

      // Newest first, adjacent retries folded. A draft that already equals the
      // newest prompt would otherwise appear twice, so the history copy is
      // dropped and the draft row stands for both.
      const entries = historyEntries(prompts, HISTORY_LIMIT);
      const newest = entries[0];
      const visible = draft !== "" && newest !== undefined && newest.text === draft
        ? entries.slice(1)
        : entries;
      const matched = filterEntries(visible, parsed.filter, HISTORY_LIMIT);

      const rows = [];
      if (draft !== "") {
        rows.push({
          key: "h:d",
          title: previewPrompt(draft),
          meta: [],
          badge: t("historyDraftBadge"),
          className: "dqs-history-row",
          run: frozen ? undefined : () => ({ type: "history", text: draft }),
        });
      }
      for (const { entry, positions } of matched) {
        const meta = [];
        if (entry.time > 0) {
          meta.push({ text: relativeTime(entry.time, t, now), className: "dqs-time" });
        }
        rows.push({
          key: `h:p:${entry.key}`,
          title: entry.title,
          positions,
          meta,
          badge: entry.kind === "steering" ? t("historySteeringBadge") : null,
          className: "dqs-history-row",
          run: frozen ? undefined : () => ({ type: "history", text: entry.text }),
        });
      }
      // Loading stops once the visible list has reached its cap: another page
      // could only add prompts that this route already dropped, so the action
      // would look broken.
      if (
        sessionId !== null &&
        history.hasMore === true &&
        entries.length < HISTORY_LIMIT
      ) {
        const loading = history.loadingOlder === true;
        rows.push({
          key: "h:o",
          action: true,
          icon: "↑",
          title: loading ? t("historyLoading") : t("historyLoadEarlier"),
          meta: [],
          className: "dqs-history-more",
          run: loading ? undefined : () => ({ type: "history-older" }),
        });
      }

      let emptyText = null;
      if (rows.length === 0) {
        if (sessionId === null) emptyText = t("historyNoSession");
        else if (filter !== "" && prompts.length > 0) {
          emptyText = t("emptyHistoryMatches");
        } else emptyText = t("emptyHistory");
      }
      // The note sits under the rows, so it explains a disabled list or a
      // filter that matched nothing instead of replacing the action row.
      let note = null;
      if (frozen && (draft !== "" || matched.length > 0)) {
        note = t("historyFrozen");
      } else if (filter !== "" && matched.length === 0 && rows.length > 0) {
        note = t("emptyHistoryMatches");
      }

      const count = (draft === "" ? 0 : 1) + matched.length;
      return {
        placeholder: t("placeholderHistory"),
        listLabel: t("listLabelHistory"),
        searchAria: t("searchAriaHistory"),
        rows,
        emptyText,
        note,
        hints: frozen
          ? [{ keys: ["Esc"], label: t("hintClose") }]
          : [
              { keys: ["Enter"], label: t("hintFill") },
              { keys: ["Esc"], label: t("hintClose") },
            ],
        count: t("countHistory", { count }),
      };
    },
  };
}
