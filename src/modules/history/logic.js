/* Prompt history: projection from chat nodes, the bridge store and the view. */

import { relativeTime } from "../../core/lib/format.js";
import { filterEntries } from "../../core/lib/search.js";

/** Rows the panel renders at most. */
export const HISTORY_LIMIT = 200;

/** Characters of one entry used for the list and matching. */
export const HISTORY_PREVIEW_LIMIT = 240;

/** Phases in which the conversation input owns the draft and refuses edits. */
export function isInputFrozen(phase) {
  return phase === "adjudicating" || phase === "submitting" || phase === "sending";
}

/** Join the text blocks of one message; images and files carry no text. */
function messageText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block !== null && typeof block === "object" && block.type === "text") {
      if (typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/** Selected labels and custom text of one recorded answer, in display order. */
function answerValues(answer) {
  if (answer === null || typeof answer !== "object") return [];
  const values = Array.isArray(answer.selected)
    ? answer.selected.filter((value) => typeof value === "string" && value.trim() !== "")
    : [];
  const custom = typeof answer.custom === "string" ? answer.custom.trim() : "";
  return custom === "" ? values : [...values, custom];
}

function collectAnswers(node, nodeKey, data, prompts) {
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const byId = new Map();
  for (const answer of answers) {
    if (answer === null || typeof answer !== "object") continue;
    if (typeof answer.id !== "string") continue;
    byId.set(answer.id, answer);
  }
  const seq = Number.isFinite(node.anchorSeq) ? node.anchorSeq : 0;
  const time = Number.isFinite(data.time) ? data.time : 0;
  const seen = new Set();
  for (const question of questions) {
    if (question === null || typeof question !== "object") continue;
    if (typeof question.id !== "string" || seen.has(question.id)) continue;
    seen.add(question.id);
    const text = answerValues(byId.get(question.id)).join(", ").trim();
    if (text === "") continue;
    const questionText = [question.header, question.question]
      .filter((part) => typeof part === "string" && part.trim() !== "")
      .join(" ");
    prompts.push({
      key: `${nodeKey}:${question.id}`,
      seq,
      time,
      kind: "answer",
      text,
      question: questionText,
    });
  }
}

/**
 * Project one chat window into chronological prompts.
 *
 * `order` is the presentation order of the loaded window, so iteration keeps
 * oldest first. `user` and `steering` nodes count as human prompts, and
 * `question-reply` nodes carry the answers to `ask_user_question`. The source
 * guard is the same one DSH uses, so a remote client's prompt stays included
 * while injected context is not. Attachment-only prompts yield no text and are
 * therefore skipped.
 */
export function collectPrompts(order, nodes) {
  const prompts = [];
  if (!Array.isArray(order) || typeof nodes?.get !== "function") return prompts;
  for (const key of order) {
    const node = nodes.get(key);
    if (node === null || node === undefined) continue;
    const nodeKey = String(node.key ?? key);
    if (node.kind === "question-reply") {
      const reply = node.data;
      if (reply !== null && typeof reply === "object") {
        collectAnswers(node, nodeKey, reply, prompts);
      }
      continue;
    }
    if (node.kind !== "user" && node.kind !== "steering") continue;
    const data = node.data;
    if (data === null || typeof data !== "object") continue;
    if (data.source?.kind !== "user") continue;
    const text = messageText(data.content);
    if (text === "") continue;
    prompts.push({
      key: nodeKey,
      seq: Number.isFinite(data.seq) ? data.seq : 0,
      time: Number.isFinite(data.time) ? data.time : 0,
      kind: node.kind,
      text,
    });
  }
  return prompts;
}

/** Collapse whitespace and clip one entry to its single-line list preview. */
export function previewPrompt(text, limit = HISTORY_PREVIEW_LIMIT) {
  const normalized = String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized === "") return "";
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

/**
 * Build the searchable rows, newest first.
 *
 * Only adjacent `user` and `steering` prompts collapse: sending the same prompt
 * twice in a row is usually a retry, but the same text separated by another
 * prompt is a real entry. Answers never collapse, because two identical answers
 * can belong to two different questions. The cap applies after collapsing.
 */
export function historyEntries(prompts, limit = HISTORY_LIMIT) {
  const rows = [];
  if (!Array.isArray(prompts) || prompts.length === 0) return rows;
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : HISTORY_LIMIT;
  let previousPrompt = null;
  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    const prompt = prompts[index];
    if (prompt === null || typeof prompt !== "object") continue;
    const foldable = prompt.kind !== "answer";
    if (foldable && previousPrompt !== null && previousPrompt === prompt.text) continue;
    previousPrompt = foldable ? prompt.text : null;
    const title = previewPrompt(prompt.text);
    if (title === "") continue;
    rows.push({
      ...prompt,
      title,
      titleLower: title.toLocaleLowerCase(),
      metaLower: typeof prompt.question === "string" ? prompt.question.toLocaleLowerCase() : "",
    });
    if (rows.length >= cap) break;
  }
  return rows;
}

/** Data every consumer sees when no session is displayed. */
const EMPTY = Object.freeze({
  sessionId: null,
  prompts: Object.freeze([]),
  draft: "",
  phase: "plain",
  hasMore: false,
  loadingOlder: false,
});

function samePrompts(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].key !== right[index].key) return false;
  }
  return true;
}

function sameSnapshot(left, right) {
  if (left.sessionId !== right.sessionId) return false;
  if (!samePrompts(left.prompts, right.prompts)) return false;
  return (
    left.draft === right.draft &&
    left.phase === right.phase &&
    left.hasMore === right.hasMore &&
    left.loadingOlder === right.loadingOlder
  );
}

/**
 * Create the history store shared by the bridge and the panel.
 *
 * `publish` merges the bridge's observation, `attach`/`detach` manage the two
 * write paths, and `apply` refuses while the input is frozen so the panel does
 * not duplicate the phase rules.
 */
export function createHistoryStore() {
  let snapshot = EMPTY;
  let handlers = null;
  const listeners = new Set();

  const publish = (next) => {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(patch) {
      const next = { ...snapshot, ...patch };
      if (samePrompts(snapshot.prompts, next.prompts)) next.prompts = snapshot.prompts;
      publish(next);
    },
    attach(sessionId, write) {
      handlers = { sessionId, ...write };
      if (snapshot.sessionId !== sessionId) {
        publish({ ...EMPTY, sessionId });
      }
    },
    detach(sessionId) {
      if (handlers === null || handlers.sessionId !== sessionId) return;
      handlers = null;
      publish(EMPTY);
    },
    hasSession() {
      return snapshot.sessionId !== null;
    },
    apply(text) {
      if (typeof text !== "string" || text === "") return false;
      if (handlers === null) return false;
      if (isInputFrozen(snapshot.phase)) return false;
      try {
        handlers.setDraft(text);
        return true;
      } catch {
        return false;
      }
    },
    loadOlder() {
      if (handlers === null) return Promise.reject(new Error("no session"));
      try {
        return Promise.resolve(handlers.loadOlder());
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

function badgeOf(entry, t) {
  if (entry.kind === "steering") return t("historySteeringBadge");
  if (entry.kind === "answer") return t("historyAnswerBadge");
  return null;
}

/**
 * The "!" view.
 *
 * `draftAtOpen` is frozen when the panel mounts: the draft row stands for the
 * text the composer held when the panel opened, not for what it holds after a
 * history row replaced it. Writing to the input stays outside the view through
 * the store, so this function only decides which rows exist and what each row
 * carries.
 */
export function createHistoryView({ api, store, draftAtOpen }) {
  return function historyView(state, panel) {
    const history = store.getSnapshot();
    const sessionId = history.sessionId ?? null;
    const prompts = Array.isArray(history.prompts) ? history.prompts : [];
    const frozen = isInputFrozen(history.phase);
    const draft = String(draftAtOpen ?? "").trim();
    const filter = state.filter.trim();

    function applyText(text) {
      if (store.apply(text)) {
        panel.setError(null);
        panel.setNotice(api.t("historyApplied"));
        return;
      }
      panel.setNotice(null);
      panel.setError(api.t("historyApplyFailed"));
    }

    function loadOlder() {
      panel.setError(null);
      const loading = store.loadOlder();
      if (loading !== null && typeof loading === "object" && typeof loading.catch === "function") {
        loading.catch(() => panel.setError(api.t("historyLoadFailed")));
      }
    }

    // Newest first, adjacent prompt retries folded; a draft that already equals
    // the newest entry would otherwise appear twice.
    const entries = historyEntries(prompts, HISTORY_LIMIT);
    const newest = entries[0];
    const visible =
      draft !== "" && newest !== undefined && newest.text === draft ? entries.slice(1) : entries;
    const matched = filterEntries(visible, state.filter, HISTORY_LIMIT);

    const rows = [];
    if (draft !== "") {
      rows.push({
        key: "h:d",
        title: previewPrompt(draft),
        meta: [],
        badge: api.t("historyDraftBadge"),
        className: "dqs-history-row",
        run: frozen ? undefined : () => applyText(draft),
      });
    }
    for (const { entry, positions } of matched) {
      const timeText = relativeTime(entry.time, api.t, panel.now);
      const meta =
        timeText === "" ? [] : [{ text: timeText, className: "dqs-time" }];
      rows.push({
        key: `h:p:${entry.key}`,
        title: entry.title,
        positions,
        meta,
        badge: badgeOf(entry, api.t),
        className: "dqs-history-row",
        run: frozen ? undefined : () => applyText(entry.text),
      });
    }
    // Loading stops once the visible list has reached its cap: another page
    // could only add prompts this view already dropped.
    if (sessionId !== null && history.hasMore === true && entries.length < HISTORY_LIMIT) {
      const loading = history.loadingOlder === true;
      rows.push({
        key: "h:o",
        action: true,
        icon: "↑",
        title: loading ? api.t("historyLoading") : api.t("historyLoadEarlier"),
        meta: [],
        className: "dqs-history-more",
        run: loading ? undefined : loadOlder,
      });
    }

    let emptyText = null;
    if (rows.length === 0) {
      if (sessionId === null) emptyText = api.t("historyNoSession");
      else if (filter !== "" && prompts.length > 0) emptyText = api.t("emptyHistoryMatches");
      else emptyText = api.t("emptyHistory");
    }
    let note = null;
    if (frozen && (draft !== "" || matched.length > 0)) {
      note = api.t("historyFrozen");
    } else if (filter !== "" && matched.length === 0 && rows.length > 0) {
      note = api.t("emptyHistoryMatches");
    }

    const count = (draft === "" ? 0 : 1) + matched.length;
    return {
      placeholder: api.t("placeholderHistory"),
      listLabel: api.t("listLabelHistory"),
      searchAria: api.t("searchAriaHistory"),
      rows,
      emptyText,
      note,
      hints: frozen
        ? [{ keys: ["Esc"], label: api.t("hintClose") }]
        : [
            { keys: ["Enter"], label: api.t("hintFill") },
            { keys: ["Esc"], label: api.t("hintClose") },
          ],
      count: api.t("countHistory", { count }),
    };
  };
}
