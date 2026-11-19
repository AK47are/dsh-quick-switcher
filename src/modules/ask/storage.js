/* Browser-local persistence for side-question records. */

import { LOWEST_EFFORT } from "./models.js";

/**
 * Versioned key for the record list.
 *
 * The key carries the shape version so a future change can move to `.v2`
 * without reinterpreting documents written by this release. A side question
 * leaves no session event, so this is the only durable copy it has.
 */
export const ASK_RECORDS_STORAGE_KEY = "dsh-quick-switcher.ask-records.v1";

/**
 * Largest byte cap the setting accepts.
 *
 * The cap exists to stay inside the browser's storage, and the quota is a few
 * megabytes; offering a larger number would only promise space the store cannot
 * use. Ten megabytes leaves room above any realistic side-question history
 * while keeping a typo from turning into an unbounded document.
 */
export const ASK_RECORD_LIMIT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The cap a fresh profile starts with.
 *
 * One megabyte holds far more than the 160 records the session caps allow at a
 * typical size, so the default never evicts a normal history; it only bounds a
 * pathological one. A reader who never opens Settings still gets a finite,
 * measured budget instead of an "unset" state.
 */
export const ASK_RECORD_LIMIT_DEFAULT_BYTES = 1024 * 1024;

/** Statuses a stored record may carry; anything else is treated as corrupt. */
const STATUS_VALUES = new Set(["running", "done", "aborted", "error"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the chosen byte cap.
 *
 * The setting is a free size in megabytes; zero, a blank field, or a
 * hand-edited value all fall back to the default budget instead of turning the
 * cap off. The upper end is clamped, and a negative or non-numeric value is
 * treated the same way as an empty input.
 */
export function readAskRecordLimit(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return ASK_RECORD_LIMIT_DEFAULT_BYTES;
  }
  return Math.min(Math.floor(value), ASK_RECORD_LIMIT_MAX_BYTES);
}

/**
 * Convert the megabytes typed into the settings input to stored bytes.
 *
 * The input is the only writer of this setting, so the conversion lives next to
 * the reader: rounding here keeps the value the user sees and the value the
 * store compares against the same number. A blank or zero field means "use the
 * default", which is what clearing the input is meant to do; the control
 * rejects out-of-range entries before calling this.
 */
export function askRecordLimitBytesOfMegabytes(value) {
  const megabytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    return ASK_RECORD_LIMIT_DEFAULT_BYTES;
  }
  return Math.min(Math.round(megabytes * 1024 * 1024), ASK_RECORD_LIMIT_MAX_BYTES);
}

/**
 * Normalize the pinned model choice.
 *
 * A provider without a model is not a choice: the record then follows the
 * session, so both strings are cleared together while the effort keeps its
 * value. This mirrors the store's capture rule, and it repairs a hand-edited
 * document instead of throwing the whole record away.
 */
function normalizeChoice(value) {
  if (!isPlainObject(value)) return { provider: "", model: "", effort: LOWEST_EFFORT };
  const provider = typeof value.provider === "string" ? value.provider : "";
  const model = typeof value.model === "string" ? value.model : "";
  const effort =
    typeof value.effort === "string" && value.effort !== "" ? value.effort : LOWEST_EFFORT;
  if (provider === "" || model === "") return { provider: "", model: "", effort };
  return { provider, model, effort };
}

/**
 * Turn one persisted value into a record the store can use, or null.
 *
 * A record that lost its identity, its session, its question, or a known
 * status cannot be rendered or asked again, so it is dropped rather than
 * repaired into a misleading row. Everything else is repaired field by field:
 * a hand-edited document must not let a string land where the detail expects
 * an array or a number.
 *
 * A record stored while it was still streaming is returned as `aborted`: no
 * request survives a page reload, so the answer is known to be incomplete and
 * the partial answer and reasoning stay readable.
 */
export function normalizeAskRecord(value) {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  const question = typeof value.question === "string" ? value.question.trim() : "";
  if (id === "" || sessionId === "" || question === "") return null;
  if (!STATUS_VALUES.has(value.status)) return null;
  const startedAt =
    typeof value.startedAt === "number" && Number.isFinite(value.startedAt) && value.startedAt >= 0
      ? value.startedAt
      : null;
  if (startedAt === null) return null;
  return {
    id,
    sessionId,
    question,
    answer: typeof value.answer === "string" ? value.answer : "",
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    includeAttachments: typeof value.includeAttachments === "boolean" ? value.includeAttachments : true,
    choice: normalizeChoice(value.choice),
    provider: typeof value.provider === "string" ? value.provider : "",
    model: typeof value.model === "string" ? value.model : "",
    effort: typeof value.effort === "string" ? value.effort : "",
    effortName: typeof value.effortName === "string" ? value.effortName : "",
    usage: isPlainObject(value.usage) ? value.usage : null,
    status: value.status === "running" ? "aborted" : value.status,
    error: typeof value.error === "string" ? value.error : null,
    atSeq:
      typeof value.atSeq === "number" && Number.isInteger(value.atSeq) && value.atSeq >= 0
        ? value.atSeq
        : null,
    startedAt,
  };
}

/**
 * Parse the stored document into records, newest first.
 *
 * Corrupt JSON, a foreign top-level shape, duplicate ids, and individually
 * broken records all collapse to the usable subset: one bad entry must not
 * cost the user the rest of the history. Sorting is by question time, which is
 * also the order the list and the caps expect.
 */
export function parseAskRecords(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records = [];
  for (const value of parsed) {
    const record = normalizeAskRecord(value);
    if (record !== null) records.push(record);
  }
  records.sort((left, right) => right.startedAt - left.startedAt);
  const seen = new Set();
  const unique = [];
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    unique.push(record);
  }
  return unique;
}

/**
 * The fields written to storage.
 *
 * Built explicitly instead of spreading the record: the pending-interaction
 * background is request-time input, not record state, and a future in-memory
 * field must not start leaking into the document just because it exists.
 */
function persistedAskRecord(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    question: record.question,
    answer: typeof record.answer === "string" ? record.answer : "",
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
    includeAttachments: record.includeAttachments !== false,
    choice: normalizeChoice(record.choice),
    provider: typeof record.provider === "string" ? record.provider : "",
    model: typeof record.model === "string" ? record.model : "",
    effort: typeof record.effort === "string" ? record.effort : "",
    effortName: typeof record.effortName === "string" ? record.effortName : "",
    usage: isPlainObject(record.usage) ? record.usage : null,
    status: record.status,
    error: typeof record.error === "string" ? record.error : null,
    atSeq:
      typeof record.atSeq === "number" && Number.isInteger(record.atSeq) && record.atSeq >= 0
        ? record.atSeq
        : null,
    startedAt: record.startedAt,
  };
}

/** Serialize records exactly as they are written; the measure uses this too. */
export function serializeAskRecords(records) {
  const list = Array.isArray(records) ? records : [];
  return JSON.stringify(list.map(persistedAskRecord));
}

/**
 * Weigh the document the way localStorage accounts for it.
 *
 * Browsers count UTF-16 code units, so two bytes per JavaScript string unit is
 * the number that matters when the payload competes for a quota. The text is
 * returned as well because the readout and the settings projection must be
 * derived from the exact bytes that would be written, never from an estimate.
 */
export function weighAskRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const text = serializeAskRecords(list);
  return { count: list.length, text, units: text.length, bytes: text.length * 2 };
}

/**
 * Drop the oldest records until the document fits the chosen byte cap.
 *
 * Running records are kept even when they alone exceed the cap: they cannot be
 * reconstructed, and the next settled record can be dropped instead. The
 * settings readout calls this before the next write, so it describes the same
 * rule the store will apply.
 */
export function trimAskRecordsToLimit(records, limit) {
  const list = Array.isArray(records) ? records.slice() : [];
  if (!Number.isFinite(limit) || limit <= 0) return list;
  while (list.length > 0 && weighAskRecords(list).bytes > limit) {
    let dropIndex = -1;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (list[index].status !== "running") {
        dropIndex = index;
        break;
      }
    }
    if (dropIndex < 0) break;
    list.splice(dropIndex, 1);
  }
  return list;
}

/**
 * How many records the cap holds at the current average length.
 *
 * Null when there is nothing to average: an empty or corrupt history has no
 * measured size, and inventing a per-record constant would make the readout a
 * guess rather than a measurement.
 */
export function projectAskRecordCount(weigh, limit) {
  if (!isPlainObject(weigh)) return null;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (!Number.isFinite(weigh.bytes) || weigh.bytes <= 0) return null;
  if (!Number.isFinite(weigh.count) || weigh.count <= 0) return null;
  return Math.floor((limit * weigh.count) / weigh.bytes);
}

/**
 * Human-readable size for the settings readout; units match the cap labels.
 *
 * Below ten kilobytes a rounded whole number hides too much: a single short
 * exchange is under 1 KB, and showing it as "1 KB" makes the record estimate
 * look inconsistent with the size beside it. One decimal keeps small values
 * legible, while large caps stay in whole kilobytes or megabytes.
 */
export function formatAskRecordSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kilobytes = bytes / 1024;
  if (kilobytes < 10) return `${Number(kilobytes.toFixed(1))} KB`;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  const megabytes = kilobytes / 1024;
  return `${Number.isInteger(megabytes) ? String(megabytes) : megabytes.toFixed(1)} MB`;
}

/**
 * One reference exchange used while the browser holds no records.
 *
 * The settings readout translates a cap into a record count, and a fresh
 * profile has no measured average. This record mirrors the fixture the storage
 * tests measure: a medium answer and a medium thinking block. It is weighed by
 * the same serializer as real records, so the empty-state estimate is measured
 * rather than a constant written into the copy; the UI labels it as a reference
 * and switches to the real average as soon as one record exists.
 */
const REFERENCE_RECORD = Object.freeze({
  id: "ask-reference",
  sessionId: "reference",
  question: "这个改动会影响哪些会话？",
  answer: "答".repeat(900),
  reasoning: "思".repeat(600),
  includeAttachments: true,
  choice: Object.freeze({ provider: "deepseek", model: "deepseek-chat", effort: "lowest" }),
  provider: "deepseek",
  model: "deepseek-chat",
  effort: "low",
  effortName: "Low",
  usage: Object.freeze({ inputTokens: 1200, outputTokens: 600 }),
  status: "done",
  error: null,
  atSeq: 12,
  startedAt: 1,
});

let referenceWeigh = null;

/** Weigh the reference record once; the settings readout reuses it. */
export function referenceAskRecordWeigh() {
  if (referenceWeigh === null) {
    referenceWeigh = weighAskRecords([normalizeAskRecord(REFERENCE_RECORD)]);
  }
  return referenceWeigh;
}

/** localStorage without trusting the host: some shells deny or hide it. */
function resolveStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Drop the oldest settled record for one quota retry; null when none is left. */
function dropOldestAskRecord(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].status === "running") continue;
    const next = records.slice();
    next.splice(index, 1);
    return next;
  }
  return null;
}

/**
 * Build the storage facade over a storage-like object.
 *
 * `load` never throws: a denied, empty, or corrupt document reads as no
 * records, because the panel must keep working on a profile whose storage was
 * cleared or edited by hand. `save` retries after dropping the oldest settled
 * record when the browser refuses the write, so a nearly full quota costs the
 * oldest history instead of the newest question. When even that fails the
 * in-memory store keeps serving this run and one warning names the cause.
 */
export function createAskRecordStorage({ storage } = {}) {
  const target = storage ?? resolveStorage();
  let hasWarned = false;

  function read() {
    try {
      return target?.getItem?.(ASK_RECORDS_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  function save(records) {
    let attempt = Array.isArray(records) ? records.slice() : [];
    if (target === null || typeof target.setItem !== "function") {
      return { ok: false, records: attempt, text: serializeAskRecords(attempt) };
    }
    for (;;) {
      const text = serializeAskRecords(attempt);
      try {
        target.setItem(ASK_RECORDS_STORAGE_KEY, text);
        return { ok: true, records: attempt, text };
      } catch (error) {
        const smaller = dropOldestAskRecord(attempt);
        if (smaller === null) {
          if (!hasWarned) {
            hasWarned = true;
            console.error(
              "[dsh-quick-switcher] side question records could not be saved",
              error,
            );
          }
          return { ok: false, records: attempt, text };
        }
        attempt = smaller;
      }
    }
  }

  return {
    load() {
      return parseAskRecords(read());
    },
    save,
    clear() {
      try {
        target?.removeItem?.(ASK_RECORDS_STORAGE_KEY);
      } catch {
        // Only the persisted copy survives a denied storage; nothing to do.
      }
    },
  };
}
