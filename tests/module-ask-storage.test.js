import assert from "node:assert/strict";
import test from "node:test";
import {
  ASK_RECORDS_STORAGE_KEY,
  ASK_RECORD_LIMIT_DEFAULT_BYTES,
  ASK_RECORD_LIMIT_MAX_BYTES,
  askRecordLimitBytesOfMegabytes,
  createAskRecordStorage,
  formatAskRecordSize,
  normalizeAskRecord,
  parseAskRecords,
  projectAskRecordCount,
  readAskRecordLimit,
  referenceAskRecordWeigh,
  serializeAskRecords,
  trimAskRecordsToLimit,
  weighAskRecords,
} from "../src/modules/ask/storage.js";

/** One complete stored record, with fields the writer must drop. */
function stored(overrides = {}) {
  return {
    id: "ask-1",
    sessionId: "s1",
    question: "why",
    answer: "because",
    reasoning: "thinking",
    includeAttachments: true,
    choice: { provider: "deepseek", model: "flash", effort: "lowest" },
    provider: "deepseek",
    model: "flash",
    effort: "low",
    effortName: "Low",
    usage: { inputTokens: 1, outputTokens: 2 },
    status: "done",
    error: null,
    atSeq: 4,
    startedAt: 1000,
    context: "pending card text",
    contextLabel: "Approval · Bash",
    ...overrides,
  };
}

/** A storage double that counts nothing and never fails. */
function memoryStorage(initial = null) {
  const map = new Map();
  if (initial !== null) map.set(ASK_RECORDS_STORAGE_KEY, initial);
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

/** A storage double that refuses documents larger than `maxUnits` code units. */
function cappedStorage(maxUnits) {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (value.length > maxUnits) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key) => map.delete(key),
  };
}

test("the cap falls back to the default and clamps the extreme", () => {
  assert.equal(readAskRecordLimit(0), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(readAskRecordLimit(-1), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(readAskRecordLimit("1 MB"), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(readAskRecordLimit(undefined), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(readAskRecordLimit(1024), 1024);
  assert.equal(readAskRecordLimit(1.9), 1);
  assert.equal(readAskRecordLimit(ASK_RECORD_LIMIT_MAX_BYTES), ASK_RECORD_LIMIT_MAX_BYTES);
  assert.equal(
    readAskRecordLimit(ASK_RECORD_LIMIT_MAX_BYTES + 1),
    ASK_RECORD_LIMIT_MAX_BYTES,
  );
});

test("the megabytes typed become the stored byte cap", () => {
  assert.equal(askRecordLimitBytesOfMegabytes(1), 1024 * 1024);
  assert.equal(askRecordLimitBytesOfMegabytes(0.5), 512 * 1024);
  assert.equal(askRecordLimitBytesOfMegabytes("2"), 2 * 1024 * 1024);
  assert.equal(askRecordLimitBytesOfMegabytes(0), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(askRecordLimitBytesOfMegabytes(""), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(askRecordLimitBytesOfMegabytes("nope"), ASK_RECORD_LIMIT_DEFAULT_BYTES);
  assert.equal(askRecordLimitBytesOfMegabytes(100), ASK_RECORD_LIMIT_MAX_BYTES);
});

test("sizes print in the units the cap is entered in", () => {
  assert.equal(formatAskRecordSize(0), "0 KB");
  assert.equal(formatAskRecordSize(200), "0.2 KB");
  assert.equal(formatAskRecordSize(824), "0.8 KB");
  assert.equal(formatAskRecordSize(3768), "3.7 KB");
  assert.equal(formatAskRecordSize(512 * 1024), "512 KB");
  assert.equal(formatAskRecordSize(1024 * 1024), "1 MB");
  assert.equal(formatAskRecordSize(1024 * 1024 + 512 * 1024), "1.5 MB");
  assert.equal(formatAskRecordSize(5 * 1024 * 1024), "5 MB");
});

test("a record loses identity, a session, a question, or a status is dropped", () => {
  assert.equal(normalizeAskRecord(null), null);
  assert.equal(normalizeAskRecord({ ...stored(), id: "" }), null);
  assert.equal(normalizeAskRecord({ ...stored(), sessionId: "  " }), null);
  assert.equal(normalizeAskRecord({ ...stored(), question: "  " }), null);
  assert.equal(normalizeAskRecord({ ...stored(), status: "paused" }), null);
  assert.equal(normalizeAskRecord({ ...stored(), startedAt: "yesterday" }), null);
});

test("a stored running record comes back as aborted with its text", () => {
  const record = normalizeAskRecord(
    stored({ status: "running", answer: "half", reasoning: "thought" }),
  );
  assert.equal(record.status, "aborted");
  assert.equal(record.answer, "half");
  assert.equal(record.reasoning, "thought");
});

test("a record is repaired field by field and keeps no request-time background", () => {
  const record = normalizeAskRecord(
    stored({
      answer: 7,
      reasoning: null,
      includeAttachments: "yes",
      usage: "tokens",
      error: 12,
      atSeq: -1,
      choice: { provider: "deepseek", model: "", effort: "" },
    }),
  );
  assert.equal(record.answer, "");
  assert.equal(record.reasoning, "");
  assert.equal(record.includeAttachments, true);
  assert.equal(record.usage, null);
  assert.equal(record.error, null);
  assert.equal(record.atSeq, null);
  assert.deepEqual(record.choice, { provider: "", model: "", effort: "lowest" });
  assert.equal("context" in record, false);
  assert.equal("contextLabel" in record, false);
});

test("the reader keeps the usable subset, newest first, one record per id", () => {
  const raw = JSON.stringify([
    stored({ id: "ask-1", startedAt: 1000, question: "older" }),
    stored({ id: "ask-2", startedAt: 3000, question: "newer" }),
    { id: "ask-3" },
    "not a record",
    stored({ id: "ask-2", startedAt: 2000, question: "duplicate id" }),
  ]);
  const records = parseAskRecords(raw);
  assert.deepEqual(
    records.map((record) => record.question),
    ["newer", "older"],
  );
});

test("a corrupt or foreign document reads as no records", () => {
  assert.deepEqual(parseAskRecords("{not json"), []);
  assert.deepEqual(parseAskRecords('{"records":[]}'), []);
  assert.deepEqual(parseAskRecords("null"), []);
  assert.deepEqual(parseAskRecords(""), []);
  assert.deepEqual(parseAskRecords(null), []);
});

test("the empty-state reference is a measured medium record", () => {
  const reference = referenceAskRecordWeigh();
  assert.equal(reference.count, 1);
  // The reference is built and weighed at runtime, not copied from a constant;
  // the bound leaves room for field-name changes while still failing on a
  // gross regression.
  assert.ok(reference.bytes > 2000 && reference.bytes < 6000, String(reference.bytes));
  // The default megabyte must hold a long history at this size, not one record.
  assert.ok(projectAskRecordCount(reference, 1024 * 1024) >= 200);
});

test("the writer never includes the pending-interaction background", () => {
  const text = serializeAskRecords([
    stored({ context: "in memory only", contextLabel: "Approval · Bash" }),
  ]);
  assert.doesNotMatch(text, /pending card text/u);
  assert.doesNotMatch(text, /Approval · Bash/u);
  assert.match(text, /"reasoning":"thinking"/u);
});

test("a serialized record round-trips through the reader", () => {
  const before = normalizeAskRecord(
    stored({
      includeAttachments: false,
      usage: { inputTokens: 3, outputTokens: 4 },
      atSeq: 7,
      status: "error",
      error: "boom",
    }),
  );
  const [after] = parseAskRecords(serializeAskRecords([before]));
  assert.deepEqual(after, before);
});

test("weighing measures the exact document in UTF-16 bytes", () => {
  const records = [stored({ id: "ask-1" }), stored({ id: "ask-2", startedAt: 900 })];
  const weighed = weighAskRecords(records);
  assert.equal(weighed.count, 2);
  assert.equal(weighed.text, serializeAskRecords(records));
  assert.equal(weighed.units, weighed.text.length);
  assert.equal(weighed.bytes, weighed.text.length * 2);
  assert.equal(weighAskRecords([]).count, 0);
});

test("the projection divides the cap by the measured average", () => {
  assert.equal(projectAskRecordCount({ count: 4, bytes: 2000 }, 1000), 2);
  assert.equal(projectAskRecordCount({ count: 4, bytes: 2000 }, 500), 1);
  assert.equal(projectAskRecordCount({ count: 4, bytes: 2000 }, 400), 0);
  assert.equal(projectAskRecordCount({ count: 0, bytes: 0 }, 1000), null);
  assert.equal(projectAskRecordCount({ count: 4, bytes: 2000 }, 0), null);
  assert.equal(projectAskRecordCount(null, 1000), null);
});

test("the byte cap drops the oldest settled record first", () => {
  const newest = stored({ id: "new", answer: "x".repeat(120), startedAt: 2 });
  const oldest = stored({ id: "old", answer: "y".repeat(120), startedAt: 1 });
  const records = [newest, oldest];
  const limit = weighAskRecords([newest]).bytes;

  const kept = trimAskRecordsToLimit(records, limit);
  assert.deepEqual(
    kept.map((record) => record.id),
    ["new"],
  );
  // No cap is a copy, not the same array.
  const copied = trimAskRecordsToLimit(records, 0);
  assert.notEqual(copied, records);
  assert.deepEqual(copied, records);
});

test("the byte cap never drops a running record", () => {
  const settled = stored({ id: "settled", answer: "x".repeat(200), startedAt: 2 });
  const running = stored({ id: "running", answer: "y".repeat(200), startedAt: 1, status: "running" });
  const limit = weighAskRecords([running]).bytes;

  const kept = trimAskRecordsToLimit([settled, running], limit);
  assert.deepEqual(
    kept.map((record) => record.id),
    ["running"],
  );
});

test("storage round-trips records through a storage-like object", () => {
  const storage = memoryStorage();
  const facade = createAskRecordStorage({ storage });
  const records = [normalizeAskRecord(stored())];

  assert.deepEqual(facade.save(records), {
    ok: true,
    records,
    text: serializeAskRecords(records),
  });
  assert.equal(storage.map.has(ASK_RECORDS_STORAGE_KEY), true);
  // The settings readout must weigh exactly the text the writer stored.
  const written = storage.map.get(ASK_RECORDS_STORAGE_KEY);
  assert.equal(weighAskRecords(records).text, written);
  assert.equal(weighAskRecords(records).bytes, written.length * 2);
  assert.deepEqual(facade.load(), records);

  facade.clear();
  assert.equal(storage.map.has(ASK_RECORDS_STORAGE_KEY), false);
  assert.deepEqual(facade.load(), []);
});

test("a denied storage reads as empty and a missing writer keeps memory only", () => {
  const facade = createAskRecordStorage({ storage: memoryStorage() });
  assert.deepEqual(facade.load(), []);

  const withoutWriter = createAskRecordStorage({ storage: {} });
  const result = withoutWriter.save([normalizeAskRecord(stored())]);
  assert.equal(result.ok, false);
  assert.deepEqual(withoutWriter.load(), []);
});

test("a full quota drops the oldest record and retries the write", () => {
  const newest = normalizeAskRecord(stored({ id: "new", answer: "x".repeat(80), startedAt: 2 }));
  const oldest = normalizeAskRecord(stored({ id: "old", answer: "y".repeat(80), startedAt: 1 }));
  const limit = serializeAskRecords([newest]).length + 5;
  const storage = cappedStorage(limit);
  const facade = createAskRecordStorage({ storage });

  const result = facade.save([newest, oldest]);
  assert.equal(result.ok, true);
  const persisted = JSON.parse(storage.map.get(ASK_RECORDS_STORAGE_KEY));
  assert.deepEqual(
    persisted.map((record) => record.id),
    ["new"],
  );
});
