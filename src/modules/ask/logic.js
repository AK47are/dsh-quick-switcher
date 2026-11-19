/* Side-question records, their streaming requests, and the "?" list and detail. */

import { relativeTime } from "../../core/lib/format.js";
import { buildPendingContext } from "./context.js";
import { LOWEST_EFFORT } from "./models.js";
import { ASK_EVENTS, ASK_PATH, FORK_PATH, UNLOADED_MESSAGE } from "./shared.js";
import {
  ASK_RECORD_LIMIT_DEFAULT_BYTES,
  createAskRecordStorage,
  readAskRecordLimit,
  trimAskRecordsToLimit,
} from "./storage.js";

/** Re-render rate while an answer streams; text is kept on every chunk. */
export const ASK_DELTA_EMIT_MS = 50;

/**
 * Write rate while an answer streams; text is kept on every chunk.
 *
 * Re-rendering every 50ms is cheap, but rewriting the whole document that
 * often is not: a reload loses at most the last second of a stream, and the
 * pagehide flush closes that gap further.
 */
export const ASK_PERSIST_MS = 1000;

/**
 * Continue the local id counter past every restored record.
 *
 * Ids are `ask-<n>` and are only unique within this browser document. Starting
 * again at 1 after a reload would make a new record reuse an old id, and the
 * store resolves ids by first match, so the detail could point at the wrong
 * question. Non-matching ids are ignored; they simply cannot collide with the
 * generated form.
 */
function nextRecordId(records) {
  let max = 0;
  for (const record of records) {
    const match = /^ask-(\d+)$/u.exec(record.id);
    if (match === null) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}

/** How long the footer shows "Copied" before the label settles back. */
export const ASK_COPY_FEEDBACK_MS = 1600;

/**
 * Every code point whose NFKC form is "?".
 *
 * A Chinese, Japanese or Korean IME types the fullwidth mark by default, so
 * requiring a halfwidth `?` would force a punctuation switch before every side
 * question. The vertical and small forms are compatibility variants that paste
 * in from other tools; NFKC is the rule that groups them, and no other code
 * point normalizes to a bare "?".
 */
export const ASK_TRIGGERS = Object.freeze([
  "?", // U+003F, the ASCII mark
  "\uFF1F", // U+FF1F, fullwidth, what a CJK IME types
  "\uFE56", // U+FE56, small form
  "\uFE16", // U+FE16, vertical presentation form
]);

/**
 * The trigger a query starts with, or null when it starts with anything else.
 * Only the first character is considered here; the trailing spelling is a
 * separate mode entry, see askSuffixOf.
 */
export function askTriggerOf(query) {
  if (typeof query !== "string" || query === "") return null;
  return ASK_TRIGGERS.find((trigger) => query.startsWith(trigger)) ?? null;
}

/**
 * The trigger a query ends with, or null when it ends with anything else.
 *
 * The suffix form lets a question be typed the way it is written, with its own
 * mark at the end. Only the last character counts: a trailing space closes the
 * mode again, and the caller still has to decide whether a prefix already
 * claimed the query. Exactly one mark is consumed; repeating it keeps the
 * previous one as question text.
 */
export function askSuffixOf(query) {
  if (typeof query !== "string" || query === "") return null;
  return ASK_TRIGGERS.find((trigger) => query.endsWith(trigger)) ?? null;
}

/**
 * Statuses that earn a badge in the list.
 *
 * A finished answer is the normal case and needs no label; running, stopped,
 * and failed are the three states a reader has to distinguish at a glance.
 */
const STATUS_LABEL_KEYS = {
  running: "askStatusRunning",
  aborted: "askStatusAborted",
  error: "askStatusError",
};

/** Whether a record is still receiving an answer. */
export function isRunning(record) {
  return record?.status === "running";
}

/** Whether the answer can be copied: any non-empty text, finished or not. */
export function canCopy(record) {
  return typeof record?.answer === "string" && record.answer !== "";
}

/**
 * Whether the same question can be asked again.
 *
 * Stopped and failed records qualify: their question and pinned choice are
 * still the ones the user wants to retry, and the pending card is read again
 * when the retry is sent. The running record does not, because the store allows
 * one request per session.
 */
export function canRegenerate(record) {
  return record !== null && record !== undefined && record.status !== "running";
}

/**
 * Whether the exchange can be forked into a new session.
 *
 * A partial answer is enough: the fork replays the question-time prefix and
 * appends what the user actually saw, and stopping does not make that record
 * less true. A record without a prefix (no `start` event yet) or without any
 * answer has nothing to continue from.
 */
export function canFork(record) {
  if (record === null || record === undefined) return false;
  if (record.status === "running") return false;
  if (typeof record.answer !== "string" || record.answer.trim() === "") return false;
  return typeof record.atSeq === "number" && record.atSeq >= 0;
}

/** i18n key for a record's list badge, or null when it needs none. */
export function statusLabelKey(record) {
  return STATUS_LABEL_KEYS[record?.status] ?? null;
}

/**
 * Prepare complete or streaming reasoning for display.
 *
 * Some providers prefix reasoning with an encrypted `<signature>` block. It is
 * protocol material, not text a reader can use, so it never reaches the block.
 * While the opening tag is still streaming in there is nothing to show yet;
 * once the closing tag arrives, the visible text starts after it and its
 * leading line breaks. Plain reasoning passes through untouched.
 */
export function displayReasoning(text) {
  if (typeof text !== "string" || text === "") return "";
  if (text[0] !== "<") return text;
  const opening = "<signature>";
  const closing = "</signature>";
  if (opening.startsWith(text)) return "";
  if (!text.startsWith(opening)) return text;
  const end = text.indexOf(closing, opening.length);
  if (end === -1) return "";
  let start = end + closing.length;
  while (start < text.length) {
    if (text[start] === "\n") start += 1;
    else if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
    else break;
  }
  return text.slice(start);
}

/** The first line of a finished reasoning text, which is its best summary. */
function firstLine(text) {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

/**
 * The first line of the latest completed paragraph while reasoning streams.
 *
 * A fresh line has not finished arriving yet, so showing it would make the
 * summary flicker with every token. Walking paragraph by paragraph keeps the
 * last settled opener on screen until the next paragraph breaks.
 */
function latestCompletedParagraphFirstLine(text) {
  let summary = "";
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd =
      nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf("\n");
    const newline = text.indexOf("\n", paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== "") summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

/**
 * One line of reasoning for the collapsed row: the latest completed paragraph
 * while streaming, the opening line once settled. Bold markers are dropped
 * because the row renders plain text, not Markdown, and would show them raw.
 */
export function reasoningSummary(text, running) {
  if (typeof text !== "string" || text === "") return "";
  const summary = running
    ? latestCompletedParagraphFirstLine(text)
    : firstLine(text);
  return summary.replaceAll("**", "");
}

/**
 * POST one JSON body to a same-origin route.
 *
 * Kept as a module-level function so a test can pass its own implementation
 * instead of standing up a server. The signal is forwarded, so stopping a
 * record also cancels the network call rather than merely ignoring the rest.
 */
async function postJson(path, body, signal) {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Turn one thrown or response value into readable text for the error block. */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

/**
 * Ask the host why a request was refused.
 *
 * The host answers JSON on every error path, and its message is the only
 * explanation available; when the body is not JSON the status line remains.
 */
async function refusalOf(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error === "string" && payload.error !== "") {
      return payload.error;
    }
  } catch {
    // A non-JSON body is not worth a second failure; fall through to the code.
  }
  return `HTTP ${String(response.status)}`;
}

/**
 * Create the side-question store, backed by browser-local storage.
 *
 * One record list for the whole plugin, keyed by session. The store never
 * touches DSH session history: a side question leaves no event, and the only
 * write it can cause is the single user message a fork inserts into the new
 * session. It does mirror its list into the record storage, so a reload can
 * rebuild the same rows instead of losing a question the user just asked.
 *
 * `request`, `now`, `translate`, `includeAttachments`, `selection`,
 * `recordStorage`, `recordLimit`, and `eventTarget` are injectable so tests can
 * drive the stream with a fake clock, a fake transport, and a fake document.
 * The module passes readers for the settings scope, so a preference change
 * applies to the next question instead of to the copy of the store imported
 * here; `selection` reports the pinned provider, model, and reasoning effort,
 * with empty strings meaning "follow the session". `recordStorage` is the
 * browser-local copy of the record list, and `recordLimit` reads the byte cap
 * chosen in Settings, with 0 meaning no cap. The default `translate` is the
 * identity, which keeps the store usable outside the panel.
 */
export function createAskStore({
  request = postJson,
  now = Date.now,
  translate = (key) => key,
  includeAttachments = () => true,
  selection = () => ({}),
  recordStorage = createAskRecordStorage(),
  recordLimit = () => ASK_RECORD_LIMIT_DEFAULT_BYTES,
  eventTarget = globalThis,
} = {}) {
  /** Newest first. Every mutation replaces the record object, never edits it. */
  const items = [];

  /** Record id to the controller of the request currently writing it. */
  const controllers = new Map();

  const listeners = new Set();
  let nextId = 1;
  let lastDeltaEmit = -Infinity;
  let lastPersistAt = -Infinity;
  let disposed = false;

  // Restore before any listener subscribes: the first view built for the panel
  // must already show the previous run's records. The byte limit applies here
  // as well, so overflow that happened before the reload cannot outlive it.
  // `restoredTrimmed` records whether loading changed the set, and the first
  // write below makes the stored copy agree with memory.
  const loaded = recordStorage.load();
  for (const record of loaded) items.push(record);
  nextId = nextRecordId(items);
  const restoredLimit = trimAskRecordsToLimit(items, readLimit());
  const restoredTrimmed = restoredLimit.length !== loaded.length;
  if (restoredTrimmed) {
    items.length = 0;
    items.push(...restoredLimit);
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] side question listener failed", error);
      }
    }
  }

  function indexOf(id) {
    return items.findIndex((item) => item.id === id);
  }

  function find(id) {
    const index = indexOf(id);
    return index < 0 ? null : items[index];
  }

  function patch(id, changes) {
    const index = indexOf(id);
    if (index < 0) return null;
    const next = { ...items[index], ...changes };
    items[index] = next;
    emit();
    return next;
  }

  function entriesOf(sessionId) {
    if (typeof sessionId !== "string" || sessionId === "") return [];
    return items.filter((item) => item.sessionId === sessionId);
  }

  function runningOf(sessionId) {
    for (const item of items) {
      if (item.sessionId === sessionId && item.status === "running") return item;
    }
    return null;
  }

  /**
   * Read the chosen byte cap once.
   *
   * A broken settings reader must not break asking, so a throwing reader falls
   * back to the default budget. Zero and malformed values mean the same thing:
   * the setting always names a size, and the default is the size a fresh
   * profile starts with.
   */
  function readLimit() {
    try {
      return readAskRecordLimit(recordLimit());
    } catch (error) {
      console.error("[dsh-quick-switcher] side question record limit reader failed", error);
      return ASK_RECORD_LIMIT_DEFAULT_BYTES;
    }
  }

  /**
   * Write the current list, first dropping what the byte cap excludes.
   *
   * The cap is applied to memory as well as to storage: a list that shows
   * records which cannot survive a reload would be a lie. A running record is
   * the exception, because it cannot be reconstructed and a stream in flight
   * must stay visible; the limit is therefore soft for the newest record.
   */
  function persistNow() {
    if (disposed) return;
    const limited = trimAskRecordsToLimit(items, readLimit());
    if (limited.length !== items.length) {
      items.length = 0;
      items.push(...limited);
      emit();
    }
    recordStorage.save(items);
    lastPersistAt = now();
  }

  /** Persist a streaming update at most once per ASK_PERSIST_MS. */
  function persistStreaming() {
    if (disposed) return;
    const at = now();
    if (at - lastPersistAt < ASK_PERSIST_MS) return;
    persistNow();
  }

  /**
   * Flush when the page is hidden or unloaded.
   *
   * The streaming write is throttled, so the last second of a stream reaches
   * storage through this flush. `pagehide` is the event a reload fires last;
   * `visibilitychange` covers a tab that is backgrounded and then killed
   * without another turn. The listeners are only installed when a document
   * exists, which keeps the store quiet under `node --test`.
   */
  const pageDocument = eventTarget?.document ?? null;
  function flushNow() {
    persistNow();
  }
  function flushWhenHidden() {
    if (pageDocument?.visibilityState === "hidden") persistNow();
  }
  const canListen =
    pageDocument !== null &&
    typeof eventTarget?.addEventListener === "function" &&
    typeof pageDocument.addEventListener === "function";
  if (canListen) {
    eventTarget.addEventListener("pagehide", flushNow);
    pageDocument.addEventListener("visibilitychange", flushWhenHidden);
  }
  function removePageListeners() {
    if (!canListen) return;
    eventTarget.removeEventListener?.("pagehide", flushNow);
    pageDocument.removeEventListener?.("visibilitychange", flushWhenHidden);
  }

  /**
   * Read the pinned model choice once, at question time.
   *
   * A provider without a model is not a choice: it means the host follows the
   * session, so both strings are cleared together. The effort always has a
   * value, because the lowest level is the setting's default and the host needs
   * the intent even when no model is pinned.
   */
  function captureChoice() {
    let raw;
    try {
      raw = selection();
    } catch (error) {
      console.error("[dsh-quick-switcher] side question selection reader failed", error);
      raw = undefined;
    }
    const provider = typeof raw?.provider === "string" ? raw.provider.trim() : "";
    const model = typeof raw?.model === "string" ? raw.model.trim() : "";
    const effort = typeof raw?.effort === "string" && raw.effort !== "" ? raw.effort : LOWEST_EFFORT;
    if (provider === "" || model === "") return { provider: "", model: "", effort };
    return { provider, model, effort };
  }

  function createRecord(sessionId, question) {
    return {
      id: `ask-${nextId++}`,
      sessionId,
      question,
      answer: "",
      // Reasoning is the model's own thinking for this answer. It is shown in
      // the detail but never copied, forked, or sent back with a new question.
      reasoning: "",
      // Preferences are captured at question time, so regenerate replays the
      // same snapshot policy instead of silently adopting a newer setting.
      includeAttachments: includeAttachments() !== false,
      choice: captureChoice(),
      // What the host actually ran: the session's model when none is pinned, and
      // the floored effort. The start event fills these in.
      provider: "",
      model: "",
      effort: "",
      effortName: "",
      usage: null,
      status: "running",
      error: null,
      atSeq: null,
      startedAt: now(),
    };
  }

  /**
   * Open the stream for one record and let it settle in the background.
   *
   * `context` is the pending-interaction text read for this attempt. It is
   * request input, like the session snapshot, not record state: the store does
   * not keep it, so a regenerate after the card changed sends what is on screen
   * now instead of what the first attempt saw.
   */
  function start(record, context) {
    const controller = new AbortController();
    controllers.set(record.id, controller);
    void runStream(record.id, controller, context);
  }

  /**
   * Fold the host's Server-Sent Events into one record.
   *
   * The stream ends with `done` or `error`; a close without either means the
   * connection dropped, which is reported as an error because the answer is
   * known to be incomplete. A client-side abort is different: the record was
   * already marked stopped, so the catch returns without overwriting it.
   */
  async function runStream(id, controller, context) {
    const record = find(id);
    if (record === null) return;
    const body = {
      sessionId: record.sessionId,
      question: record.question,
      includeAttachments: record.includeAttachments,
    };
    if (record.choice.provider !== "") {
      body.provider = record.choice.provider;
      body.model = record.choice.model;
    }
    if (record.choice.effort !== "") body.reasoningEffort = record.choice.effort;
    if (typeof context === "string" && context !== "") body.context = context;
    try {
      const response = await request(ASK_PATH, body, controller.signal);
      if (response.ok !== true) throw new Error(await refusalOf(response));
      if (response.body === null || response.body === undefined) {
        throw new Error(translate("askStreamMissing"));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          handleBlock(id, buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
      }
      const latest = find(id);
      if (latest !== null && latest.status === "running") {
        patch(id, { status: "error", error: translate("askDisconnected") });
        persistNow();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const latest = find(id);
      if (latest === null || latest.status !== "running") return;
      patch(id, { status: "error", error: messageOf(error) });
      persistNow();
    } finally {
      // A regenerate replaces the controller; only the owner may remove it.
      if (controllers.get(id) === controller) controllers.delete(id);
    }
  }

  /** Apply one `data:` block of the host stream. */
  function handleBlock(id, block) {
    const lines = block.split("\n");
    let data = "";
    for (const line of lines) {
      if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    if (data === "") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (payload === null || typeof payload !== "object") return;
    const current = find(id);
    if (current === null) return;
    // A stopped or regenerated record must not absorb late events: a buffered
    // `done` arriving after the user pressed stop would erase the aborted mark.
    if (current.status !== "running") return;
    switch (payload.type) {
      case ASK_EVENTS.start:
        // The host echoes what it actually ran: the session model when no model
        // is pinned, and the level it floored the request to. Every field is
        // rewritten, so a regenerate that lands on a model without reasoning
        // clears the previous badge instead of keeping a stale one.
        patch(id, {
          atSeq: typeof payload.atSeq === "number" ? payload.atSeq : null,
          provider: typeof payload.provider === "string" ? payload.provider : "",
          model: typeof payload.model === "string" ? payload.model : "",
          effort: typeof payload.reasoningEffort === "string" ? payload.reasoningEffort : "",
          effortName:
            typeof payload.reasoningEffortName === "string" ? payload.reasoningEffortName : "",
        });
        // The effective model and level are part of the record a reload shows,
        // so they are written as soon as the host names them.
        persistNow();
        return;
      case ASK_EVENTS.delta:
        if (typeof payload.text !== "string" || payload.text === "") return;
        appendDelta(id, payload.text);
        return;
      case ASK_EVENTS.reasoning:
        // A separate event keeps older clients working: they ignore an event
        // type they do not know and still render the answer unchanged.
        if (typeof payload.text !== "string" || payload.text === "") return;
        appendReasoning(id, payload.text);
        return;
      case ASK_EVENTS.usage:
        patch(id, { usage: payload.usage ?? null });
        persistNow();
        return;
      case ASK_EVENTS.finish:
        // The reason is informational; `done` is what closes the record.
        return;
      case ASK_EVENTS.done:
        if (controllers.get(id) !== undefined) controllers.delete(id);
        patch(id, { status: "done" });
        persistNow();
        return;
      case ASK_EVENTS.error:
        patch(id, {
          status: "error",
          error:
            typeof payload.message === "string" && payload.message !== ""
              ? payload.message
              : translate("askFailed"),
        });
        persistNow();
        return;
      default:
        return;
    }
  }

  /**
   * Append streamed text and notify at most once per window.
   *
   * The text lands on the record immediately; only the re-render is throttled,
   * so the final `done` always shows everything the provider sent. Answer and
   * reasoning share one window: the panel is already re-rendering for both.
   */
  function appendStreamText(id, field, text) {
    const index = indexOf(id);
    if (index < 0) return;
    const current = items[index];
    const previous = typeof current[field] === "string" ? current[field] : "";
    items[index] = { ...current, [field]: previous + text };
    // The persisted copy is a reload checkpoint, not a render feed: it is
    // written on its own slower clock so a chatty stream cannot turn into a
    // stringify of the whole list every 50ms.
    persistStreaming();
    const at = now();
    if (at - lastDeltaEmit < ASK_DELTA_EMIT_MS) return;
    lastDeltaEmit = at;
    emit();
  }

  /** Append one answer delta. */
  function appendDelta(id, text) {
    appendStreamText(id, "answer", text);
  }

  /** Append one reasoning delta. */
  function appendReasoning(id, text) {
    appendStreamText(id, "reasoning", text);
  }

  /**
   * Create a record and ask the host.
   *
   * Refused while the session already has a running request: one question at a
   * time keeps the answer area and the session's pending card in step, and the
   * host enforces the same rule from its side.
   */
  function ask(sessionId, question, context) {
    if (typeof sessionId !== "string" || sessionId === "") return null;
    const text = String(question ?? "").trim();
    if (text === "") return null;
    if (runningOf(sessionId) !== null) return null;
    const record = createRecord(sessionId, text);
    items.unshift(record);
    // The list shows the new row before the first byte arrives.
    emit();
    // The question reaches storage before the request starts, so a reload
    // during the handshake still finds it as an aborted record instead of
    // losing the text the user just typed.
    persistNow();
    start(record, context);
    return record;
  }

  /** Stop one running record and keep whatever answer and reasoning arrived. */
  function stop(sessionId, id) {
    const record = find(id);
    if (record === null || record.sessionId !== sessionId || record.status !== "running") {
      return false;
    }
    const controller = controllers.get(id);
    controllers.delete(id);
    controller?.abort(new Error("stopped by the user"));
    patch(id, { status: "aborted" });
    persistNow();
    return true;
  }

  /** Stop every running record of one session; used when the panel closes. */
  function abortSession(sessionId) {
    for (const record of [...items]) {
      if (record.sessionId !== sessionId || record.status !== "running") continue;
      stop(sessionId, record.id);
    }
  }

  /**
   * Ask the same question again in place, with the context seen right now.
   *
   * The pending card is request input, not record state, so the regenerated
   * answer explains the interaction the user is actually looking at. A live
   * record's earlier attempt may have been about a card that has since been
   * resolved; reusing that stale text would explain the wrong screen.
   */
  function regenerate(sessionId, id, context) {
    const record = find(id);
    if (record === null || record.status === "running") return false;
    const next = patch(id, {
      answer: "",
      reasoning: "",
      usage: null,
      error: null,
      status: "running",
      // The pinned choice is replayed as-is; the effective model and level are
      // cleared until the host's start event names what this attempt ran.
      provider: "",
      model: "",
      effort: "",
      effortName: "",
    });
    if (next === null) return false;
    persistNow();
    start(next, context);
    return true;
  }

  /**
   * Fork the record into a new session and return that session's id.
   *
   * The host owns the fork: it replays the question-time prefix, waits for the
   * child to become addressable, and writes the exchange as one user message.
   * The client only names the record and navigates afterwards.
   */
  async function fork(sessionId, id) {
    const record = find(id);
    if (record === null || !canFork(record)) return null;
    const body = {
      sessionId,
      question: record.question,
      answer: record.answer.trim(),
    };
    if (typeof record.atSeq === "number") body.atSeq = record.atSeq;
    const response = await request(FORK_PATH, body);
    const payload = await response.json().catch(() => null);
    if (
      response.ok !== true ||
      typeof payload?.sessionId !== "string" ||
      payload.sessionId === ""
    ) {
      throw new Error(
        typeof payload?.error === "string" && payload.error !== ""
          ? payload.error
          : `HTTP ${String(response.status)}`,
      );
    }
    return payload.sessionId;
  }

  /**
   * Drop every record and its stored copy; used by the settings clear action.
   *
   * A running request is aborted first: its late events must not recreate a
   * record the user just erased. The key is removed instead of writing an empty
   * array, so a cleared browser holds no side-question document at all.
   */
  function clearRecords() {
    for (const controller of controllers.values()) {
      controller.abort(new Error("cleared by the user"));
    }
    controllers.clear();
    items.length = 0;
    recordStorage.clear();
    emit();
  }

  /** A copy of the live list, for the settings readout. */
  function records() {
    return items.slice();
  }

  /**
   * Abort every request and flush the last state; used when the plugin unloads.
   *
   * The list is written before the memory copy is dropped, so a page unload
   * keeps the newest streamed text. The copy is then cleared because the next
   * load rebuilds it from storage; keeping both would let a reloaded plugin
   * show a list that storage no longer agrees with.
   */
  function dispose() {
    if (disposed) return;
    persistNow();
    disposed = true;
    removePageListeners();
    for (const controller of controllers.values()) {
      controller.abort(new Error(UNLOADED_MESSAGE));
    }
    controllers.clear();
    items.length = 0;
    emit();
  }

  if (restoredTrimmed) persistNow();

  return {
    ask,
    abortSession,
    clearRecords,
    dispose,
    entriesOf,
    find,
    fork,
    records,
    regenerate,
    stop,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Whether focus sits in a control that consumes plain letters.
 *
 * A locked side-question input matches too: it is read-only, but the user can
 * still select and copy the question there, so C, R, F, and S must stay
 * letters rather than shortcuts while it has focus.
 */
export function isEditableTarget(target) {
  if (target === null || typeof target !== "object") return false;
  if (target.isContentEditable === true) return true;
  if (typeof target.closest !== "function") return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ) !== null
  );
}

/**
 * Map one keydown inside the side-question detail to the action it triggers.
 *
 * `i` takes the vim insert meaning: it hands the keyboard back to the input.
 * The quick switcher is a modal, so this panel owns the gesture. The detail
 * has exactly one input, the question field it locks while reading, and `i`
 * cannot type into a read-only field, so the gesture is read before the
 * editable rule. Backspace is deliberately absent: one action gets one key,
 * and inside a locked field Backspace shows no effect that could explain
 * itself to the user.
 *
 * The other letters stay letters while that field has focus, because the user
 * may be selecting the question to copy. A held key is dropped: returning to
 * the list focuses the input, and a repeat must not fire the action twice.
 * Composing keys and modifier chords belong to the browser and the input
 * method.
 *
 * @param event - a keydown event shape (`key`, `repeat`, `isComposing`,
 *   `keyCode`, and the three modifier flags).
 * @param state - what the current view and record allow. Every flag is read
 *   here so the caller keeps the store and the record as the single source of
 *   truth.
 * @returns {"back"|"stop"|"copy"|"regenerate"|"fork"|null}
 */
export function detailKeyAction(event, state) {
  if (event === null || typeof event !== "object") return null;
  if (state === null || typeof state !== "object") return null;
  if (event.isComposing === true || event.keyCode === 229) return null;
  if (event.repeat === true) return null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) {
    return null;
  }
  if (typeof event.key !== "string") return null;
  const key = event.key.toLowerCase();
  // The locked question field matches the editable rule, and `i` still has to
  // work there; every other letter keeps that field as a text surface.
  if (key === "i") return state.hasBack === true ? "back" : null;
  if (state.isEditable === true) return null;
  if (key === "s") return state.isRunning === true ? "stop" : null;
  if (key === "c") return state.canCopy === true ? "copy" : null;
  if (key === "r") return state.canRegenerate === true ? "regenerate" : null;
  if (key === "f") {
    return state.canFork === true && state.isForking !== true ? "fork" : null;
  }
  return null;
}

/** Feedback the detail footer shows next to its copy and fork actions. */
const EMPTY_UI = Object.freeze({ copied: false, copyFailed: false, forking: false });

/**
 * Create the tiny subscribable feedback store owned by one panel mount.
 *
 * The footer reads it through `useSyncExternalStore` and the shell's keydown
 * handler reads the same snapshot, so a copied label and a running fork cannot
 * disagree, and a fork key cannot start twice. The store lives on the mount
 * instance because it belongs to one panel, unlike the records themselves.
 */
export function createAskUi({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let snapshot = EMPTY_UI;
  const listeners = new Set();
  let timer = 0;

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("[dsh-quick-switcher] side question ui listener failed", error);
      }
    }
  }

  function set(patch) {
    const next = { ...snapshot, ...patch };
    if (
      next.copied === snapshot.copied &&
      next.copyFailed === snapshot.copyFailed &&
      next.forking === snapshot.forking
    ) {
      return;
    }
    snapshot = next;
    emit();
  }

  function cancelTimer() {
    if (timer === 0) return;
    clearTimer(timer);
    timer = 0;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markCopied() {
      cancelTimer();
      set({ copied: true, copyFailed: false });
      timer = setTimer(() => {
        timer = 0;
        set({ copied: false });
      }, ASK_COPY_FEEDBACK_MS);
    },
    markCopyFailed() {
      cancelTimer();
      set({ copied: false, copyFailed: true });
    },
    clearCopy() {
      cancelTimer();
      set({ copied: false, copyFailed: false });
    },
    setForking(value) {
      set({ forking: value === true });
    },
    dispose() {
      cancelTimer();
      listeners.clear();
    },
  };
}

/**
 * Build the detail's actions for one mount.
 *
 * `back` is supplied by the view because the detail id belongs to the view;
 * every other action takes the record the caller is looking at. Copy feedback
 * goes through the mount ui store, so the button label and the key handler see
 * one state. A fork failure keeps the panel open and is reported in place: the
 * store failure names the fork, while a refused navigation keeps the same
 * "could not open that session" text the session list uses.
 */
export function createAskActions({ api, store, ui, panel, back }) {
  function openSession(sessionId) {
    try {
      const result = api.services.uiWorkspace.openSession(sessionId);
      if (result !== null && typeof result === "object" && typeof result.catch === "function") {
        result.catch(() => panel.setError(api.t("openFailed")));
      }
      return true;
    } catch {
      panel.setError(api.t("openFailed"));
      return false;
    }
  }

  async function copy(record) {
    const answer = typeof record?.answer === "string" ? record.answer : "";
    if (answer === "") return;
    try {
      await globalThis.navigator.clipboard.writeText(answer);
      ui.markCopied();
    } catch (failure) {
      console.error("[dsh-quick-switcher] clipboard write failed", failure);
      ui.markCopyFailed();
    }
  }

  function stop(record) {
    if (record === null || record === undefined) return;
    store.stop(record.sessionId, record.id);
  }

  /**
   * Regenerate with the card the user is looking at now.
   *
   * `panel.pending` is a live getter over the latest session status, so the
   * same call works for a record restored from storage: it has no saved
   * background, and this is where a fresh one comes from.
   */
  function regenerate(record) {
    if (record === null || record === undefined) return;
    store.regenerate(
      record.sessionId,
      record.id,
      buildPendingContext(panel.pending, record.sessionId),
    );
  }

  async function fork(record) {
    if (record === null || record === undefined) return;
    if (ui.getSnapshot().forking) return;
    ui.setForking(true);
    panel.setError(null);
    try {
      const childId = await store.fork(record.sessionId, record.id);
      if (childId === null) return;
      if (!openSession(childId)) return;
      // The main area now shows a different conversation, so the caret must
      // not return to the control that existed before the panel opened.
      panel.close({ restoreFocus: false });
    } catch (failure) {
      console.error("[dsh-quick-switcher] side question fork failed", failure);
      panel.setError(api.t("askForkFailed"));
    } finally {
      ui.setForking(false);
    }
  }

  return { back, copy, stop, regenerate, fork };
}

/**
 * Build the "?" view for one panel mount.
 *
 * The text after a leading trigger, or before a trailing one, is the question,
 * never a filter: a side question is one sentence the user wants answered, and
 * matching history against it would only ever hide the row they need. A bare
 * trigger lists the current session's records, which is also where a
 * half-finished answer can be reopened.
 *
 * The view owns one piece of navigation state, `detailId`. It survives a query
 * change so a stream that lands while the detail is open keeps updating in
 * place, and it is cleared by `back` rather than by the panel: the shell only
 * renders what the view returns. A record can disappear only through the
 * session cap, so a detail id that no longer resolves is dropped here instead
 * of rendering a header that points at nothing.
 *
 * The store and ui are passed in so the view stays free of React and can be
 * unit tested with plain Node.
 */
export function createAskView({ api, store, ui, actions }) {
  let detailId = null;
  /** Last non-null current session, used to abort its request on close. */
  let lastSessionId = null;

  function entriesOf(sessionId) {
    if (sessionId === null) return [];
    return store.entriesOf(sessionId) ?? [];
  }

  function back(panel) {
    detailId = null;
    panel.notify();
  }

  /**
   * The trigger the input currently carries and the end it sits on.
   *
   * The locked input is re-seeded from the row's own text, so it keeps the mark
   * the user actually typed and its position: a question typed after `？` was
   * never halfwidth, and a question ended with `?` was never a prefix. The
   * fallback covers tests and a query that has not resolved to ask yet.
   */
  function markOf(panel) {
    const prefix = askTriggerOf(panel.query);
    if (prefix !== null) return { mark: prefix, isSuffix: false };
    const suffix = askSuffixOf(panel.query);
    if (suffix !== null) return { mark: suffix, isSuffix: true };
    return { mark: "?", isSuffix: false };
  }

  /**
   * Rebuild the query from a question, keeping the mark where the user put it.
   *
   * A suffix mark stays at the end, so returning from the detail shows the same
   * form that was typed; a prefix mark stays in front, as before.
   */
  function queryFor(text, panel) {
    const { mark, isSuffix } = markOf(panel);
    return isSuffix ? `${text}${mark}` : `${mark}${text}`;
  }

  /**
   * One history row. The badge only appears for states that need a word:
   * a finished answer is the normal case.
   */
  function historyRow(record, panel) {
    const time = relativeTime(record.startedAt, api.t, panel.now);
    const labelKey = statusLabelKey(record);
    return {
      key: `a:h:${record.id}`,
      title: record.question,
      meta: time === "" ? [] : [{ text: time, className: "dqs-time" }],
      badge: labelKey === null ? null : api.t(labelKey),
      className: "dqs-ask-row",
      run() {
        detailId = record.id;
        // The store already announced the new record; this second request
        // makes the detail render even if that announcement is ever flushed
        // before `detailId` was assigned.
        panel.notify();
        panel.setQuery(queryFor(record.question, panel));
      },
    };
  }

  function detailView(record, panel) {
    const id = record.id;
    return {
      placeholder: api.t("placeholderAsk"),
      searchAria: api.t("searchAriaAsk"),
      listLabel: api.t("listLabelAsk"),
      rows: [],
      // A detail view is not an empty list: the panel renders the component
      // instead of the listbox, and an empty `rows` array keeps every other
      // consumer of the view shape honest.
      content: { kind: "ask", props: { id } },
      footer: { kind: "ask", props: { id } },
      inputLocked: true,
      hints: [],
      count: "",
      keydown(event, context) {
        // Read the record again instead of trusting the render: a late chunk
        // may have changed what the record allows since the view was built.
        const live = store.find(id) ?? record;
        const action = detailKeyAction(event.nativeEvent ?? event, {
          hasBack: true,
          isEditable: isEditableTarget(event.target),
          isRunning: isRunning(live),
          canCopy: canCopy(live),
          canRegenerate: canRegenerate(live),
          canFork: canFork(live),
          isForking: ui.getSnapshot().forking,
        });
        if (action === null) return false;
        if (action === "back") back(context);
        else if (action === "stop") actions.stop(live);
        else if (action === "copy") void actions.copy(live);
        else if (action === "regenerate") actions.regenerate(live);
        else if (action === "fork") void actions.fork(live);
        return true;
      },
    };
  }

  function view(state, panel) {
    const currentId = panel.currentSessionId ?? null;
    if (typeof currentId === "string" && currentId !== "") lastSessionId = currentId;

    const detail = detailId === null ? null : store.find(detailId);
    if (detailId !== null && detail === null) detailId = null;
    if (detail !== null) return detailView(detail, panel);

    const entries = entriesOf(currentId);
    const running = entries.some((entry) => entry.status === "running");
    const text = typeof state?.text === "string" ? state.text.trim() : "";
    const rows = [];

    // The ask row is only honest when there is a session to ask in and a
    // question to send. It carries no `action` flag so typing keeps it as the
    // default row.
    if (text !== "" && currentId !== null) {
      rows.push({
        key: "a:q",
        title: api.t("askRow", { question: text }),
        meta: running ? [{ text: api.t("askBusy") }] : [],
        className: "dqs-ask-row",
        run:
          running === true
            ? undefined
            : () => {
                const record = store.ask(
                  currentId,
                  text,
                  buildPendingContext(panel.pending, currentId),
                );
                if (record === null || record === undefined) return;
                detailId = record.id;
                // The store already announced the new record; this second
                // request makes the detail render even if that announcement is
                // ever flushed before `detailId` was assigned.
                panel.notify();
                panel.setQuery(queryFor(text, panel));
              },
      });
    }
    for (const record of entries) rows.push(historyRow(record, panel));

    let emptyText = null;
    if (currentId === null) emptyText = api.t("askNoSession");
    else if (rows.length === 0) emptyText = api.t("emptyAsk");

    // With no text typed the running request is invisible otherwise: the
    // list just looks like it has no way to ask anything.
    const note = running && text === "" ? api.t("askRunningNote") : null;

    const hints = [];
    if (text !== "") hints.push({ keys: ["Enter"], label: api.t("hintAskSend") });
    else if (entries.length > 0) hints.push({ keys: ["Enter"], label: api.t("hintAskView") });
    hints.push({ keys: ["Esc"], label: api.t("hintClose") });

    return {
      placeholder: api.t("placeholderAsk"),
      searchAria: api.t("searchAriaAsk"),
      listLabel: api.t("listLabelAsk"),
      rows,
      emptyText,
      note,
      hints,
      count: api.t("countAsk", { count: entries.length }),
    };
  }

  return {
    view,
    back,
    getDetailId: () => detailId,
    getSessionId: () => lastSessionId,
  };
}

