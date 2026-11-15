/* Side-question records, their streaming requests, and the fork call. */

export const ASK_PATH = "/dsh-quick-switcher/ask";
export const FORK_PATH = "/dsh-quick-switcher/fork";

/** Re-render rate while an answer streams; text is kept on every chunk. */
const DELTA_EMIT_MS = 50;

/** Records kept per session; the oldest one is dropped first. */
const RECORD_LIMIT = 20;

/** Sessions whose records survive; the least recently asked is dropped. */
const SESSION_LIMIT = 8;

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
 * Stopped and failed records qualify: their question and background are still
 * the ones the user wants to retry. The running record does not, because the
 * store allows one request per session.
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
 * Create the in-memory side-question store.
 *
 * One record list for the whole plugin, keyed by session. The store never
 * touches DSH session history: a side question leaves no event, and the only
 * write it can cause is the single user message a fork inserts into the new
 * session.
 *
 * `request`, `now`, and `translate` are injectable so tests can drive the
 * stream with a fake clock and a fake transport. The default `translate` is the
 * identity, which keeps the store importable outside the panel.
 */
export function createAskStore({
  request = postJson,
  now = Date.now,
  translate = (key) => key,
  includeAttachments = () => true,
} = {}) {
  /** Newest first. Every mutation replaces the record object, never edits it. */
  const items = [];

  /** Record id to the controller of the request currently writing it. */
  const controllers = new Map();

  const listeners = new Set();
  let nextId = 1;
  let lastDeltaEmit = -Infinity;

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
   * Drop the oldest records of one session past the cap.
   *
   * A running record is never dropped: it is the newest of its session anyway,
   * but keeping the check explicit makes the invariant readable.
   */
  function trimRecords(sessionId) {
    const owned = [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].sessionId === sessionId) owned.push(index);
    }
    for (const index of owned.slice(0, Math.max(0, owned.length - RECORD_LIMIT))) {
      if (items[index].status === "running") continue;
      items.splice(index, 1);
    }
  }

  /**
   * Drop the least recently asked sessions past the cap.
   *
   * Order comes from each session's newest record, so "recently asked" means
   * the last question in that session, not the last time it was viewed. A
   * session with a running request survives regardless of its age.
   */
  function trimSessions() {
    /** @type {Map<string, number>} */
    const newest = new Map();
    for (const item of items) {
      if (!newest.has(item.sessionId)) newest.set(item.sessionId, item.startedAt);
    }
    if (newest.size <= SESSION_LIMIT) return;
    const keep = new Set(
      [...newest.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, SESSION_LIMIT)
        .map(([sessionId]) => sessionId),
    );
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (keep.has(item.sessionId)) continue;
      if (item.status === "running") continue;
      items.splice(index, 1);
    }
  }

  function createRecord(sessionId, question, context) {
    return {
      id: `ask-${nextId++}`,
      sessionId,
      question,
      answer: "",
      context: typeof context?.text === "string" ? context.text : "",
      contextLabel: typeof context?.label === "string" ? context.label : "",
      // The preference is captured at question time, so regenerate replays the
      // same snapshot policy instead of silently adopting a newer setting.
      includeAttachments: includeAttachments() !== false,
      model: "",
      usage: null,
      status: "running",
      error: null,
      atSeq: null,
      startedAt: now(),
    };
  }

  /** Open the stream for one record and let it settle in the background. */
  function start(record) {
    const controller = new AbortController();
    controllers.set(record.id, controller);
    void runStream(record.id, controller);
  }

  /**
   * Fold the host's Server-Sent Events into one record.
   *
   * The stream ends with `done` or `error`; a close without either means the
   * connection dropped, which is reported as an error because the answer is
   * known to be incomplete. A client-side abort is different: the record was
   * already marked stopped, so the catch returns without overwriting it.
   */
  async function runStream(id, controller) {
    const record = find(id);
    if (record === null) return;
    const body = {
      sessionId: record.sessionId,
      question: record.question,
      includeAttachments: record.includeAttachments,
    };
    if (record.context !== "") body.context = record.context;
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
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const latest = find(id);
      if (latest === null || latest.status !== "running") return;
      patch(id, { status: "error", error: messageOf(error) });
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
      case "start":
        patch(id, {
          atSeq: typeof payload.atSeq === "number" ? payload.atSeq : null,
          model: typeof payload.model === "string" ? payload.model : "",
        });
        return;
      case "delta":
        if (typeof payload.text !== "string" || payload.text === "") return;
        appendDelta(id, payload.text);
        return;
      case "usage":
        patch(id, { usage: payload.usage ?? null });
        return;
      case "finish":
        // The reason is informational; `done` is what closes the record.
        return;
      case "done":
        if (controllers.get(id) !== undefined) controllers.delete(id);
        patch(id, { status: "done" });
        return;
      case "error":
        patch(id, {
          status: "error",
          error:
            typeof payload.message === "string" && payload.message !== ""
              ? payload.message
              : translate("askFailed"),
        });
        return;
      default:
        return;
    }
  }

  /**
   * Append streamed text and notify at most once per window.
   *
   * The text lands on the record immediately; only the re-render is throttled,
   * so the final `done` always shows everything the provider sent.
   */
  function appendDelta(id, text) {
    const index = indexOf(id);
    if (index < 0) return;
    items[index] = { ...items[index], answer: items[index].answer + text };
    const current = now();
    if (current - lastDeltaEmit < DELTA_EMIT_MS) return;
    lastDeltaEmit = current;
    emit();
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
    const record = createRecord(sessionId, text, context);
    items.unshift(record);
    trimRecords(sessionId);
    trimSessions();
    // The list shows the new row before the first byte arrives.
    emit();
    start(record);
    return record;
  }

  /** Stop one running record and keep whatever answer already arrived. */
  function stop(sessionId, id) {
    const record = find(id);
    if (record === null || record.sessionId !== sessionId || record.status !== "running") {
      return false;
    }
    const controller = controllers.get(id);
    controllers.delete(id);
    controller?.abort(new Error("stopped by the user"));
    patch(id, { status: "aborted" });
    return true;
  }

  /** Stop every running record of one session; used when the panel closes. */
  function abortSession(sessionId) {
    for (const record of [...items]) {
      if (record.sessionId !== sessionId || record.status !== "running") continue;
      stop(sessionId, record.id);
    }
  }

  /** Ask the same question with the same background once more, in place. */
  function regenerate(sessionId, id) {
    const record = find(id);
    if (record === null || record.status === "running") return false;
    const next = patch(id, {
      answer: "",
      usage: null,
      error: null,
      status: "running",
    });
    if (next === null) return false;
    start(next);
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
    if (record.context !== "") body.context = record.context;
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

  /** Abort every request and drop every record; used when the plugin unloads. */
  function dispose() {
    for (const controller of controllers.values()) {
      controller.abort(new Error("dsh-quick-switcher was unloaded"));
    }
    controllers.clear();
    items.length = 0;
    emit();
  }

  return {
    ask,
    abortSession,
    dispose,
    entriesOf,
    find,
    fork,
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
