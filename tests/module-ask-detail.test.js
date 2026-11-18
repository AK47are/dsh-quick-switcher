/* Detail view rendering: the answer goes through the session panel's Markdown
 * renderer with the copy it needs, and streamed answers stay on the streaming
 * pass until the record settles. */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/** Bundle the real detail module with the React and DSH primitive stubs. */
async function loadDetail() {
  const entry = fileURLToPath(new URL("../src/modules/ask/detail.js", import.meta.url));
  const react = fileURLToPath(new URL("./react-stub.js", import.meta.url));
  const primitives = fileURLToPath(new URL("./primitives-stub.js", import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    plugins: [
      {
        name: "dsh-stubs",
        setup(builder) {
          builder.onResolve({ filter: /^react$/ }, () => ({ path: react }));
          builder.onResolve(
            { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
            () => ({ path: primitives }),
          );
        },
      },
    ],
  });
  const directory = await mkdtemp(join(tmpdir(), "dqs-detail-"));
  const file = join(directory, "detail.mjs");
  try {
    await writeFile(file, result.outputFiles[0].text, "utf8");
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Depth-first search over the element tree the stubbed React returns. */
function find(node, predicate, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const child of node) find(child, predicate, out);
    return out;
  }
  if (typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  find(node.children, predicate, out);
  return out;
}

function answerElement(tree) {
  return find(tree, (node) => node.type === "MarkdownText")[0] ?? null;
}

/** The reasoning disclosure row, or null when the record has none. */
function thinkRow(tree) {
  return find(tree, (node) => node.type === "DisclosureRow")[0] ?? null;
}

/** The plain summary the collapsed row shows beside its title. */
function summaryOf(row) {
  const shimmer = find(row?.props?.collapsedContent, (node) => node.type === "TextShimmer")[0];
  return shimmer?.children?.[0] ?? null;
}

function waitingRow(tree) {
  return find(tree, (node) => node.props?.className === "dqs-ask-waiting")[0] ?? null;
}

function hasWaitingPlaceholder(tree) {
  return waitingRow(tree) !== null;
}

const ZH = {
  askCodeCopy: "复制",
  askCodeCopied: "已复制",
  askCodeTitle: "代码",
  askCodeWrap: "自动换行",
  askCodeUnwrap: "取消换行",
  askFootnotes: "脚注",
  askStatusRunning: "运行中",
  askWaiting: "正在分析请求…",
  askThinkingTitle: "思考",
  askEmptyAnswer: "没有返回内容",
  usageInput: "输入",
  usageOutput: "输出",
};

const EN = {
  askCodeCopy: "Copy",
  askCodeCopied: "Copied",
  askCodeTitle: "Code",
  askCodeWrap: "Wrap",
  askCodeUnwrap: "Unwrap",
  askFootnotes: "Footnotes",
  askStatusRunning: "Running",
  askWaiting: "Analyzing the request…",
  askThinkingTitle: "Think",
  askEmptyAnswer: "No content returned",
  usageInput: "input",
  usageOutput: "output",
};

function translateWith(dictionary) {
  return (key, params) => {
    const text = dictionary[key] ?? key;
    if (params === undefined || params === null) return text;
    return text.replace(/\{(\w+)\}/gu, (match, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  };
}

function makeRecord(overrides = {}) {
  return {
    id: "ask-1",
    sessionId: "session-1",
    question: "why",
    answer: "见 [示例](https://example.com)",
    reasoning: "",
    context: "",
    contextLabel: "",
    model: "deepseek-chat",
    usage: { inputTokens: 10, outputTokens: 5 },
    effort: "",
    effortName: "",
    error: null,
    status: "running",
    ...overrides,
  };
}

function makeInstance(record) {
  return {
    store: {
      subscribe: () => () => {},
      find: (id) => (record !== null && record.id === id ? record : null),
    },
    ui: {
      subscribe: () => () => {},
      getSnapshot: () => ({ copied: false, copyFailed: false, forking: false }),
    },
    actions: {},
  };
}

function render(detail, record, t) {
  return detail.AskDetail({
    descriptor: { props: { id: record.id } },
    instance: makeInstance(record),
    t,
  });
}

test("a running answer renders through the shared Markdown renderer", async () => {
  const detail = await loadDetail();
  const record = makeRecord();
  const element = answerElement(render(detail, record, translateWith(ZH)));

  assert.notEqual(element, null);
  assert.equal(element.props.text, record.answer);
  assert.equal(element.props.streaming, true);
  assert.deepEqual(element.props.labels, {
    code: {
      copyLabel: "复制",
      copiedLabel: "已复制",
      toolbarLabels: { codeLabel: "代码", wrapLabel: "自动换行", unwrapLabel: "取消换行" },
    },
    footnotes: "脚注",
  });
});

test("a settled answer leaves the streaming pass", async () => {
  const detail = await loadDetail();
  const record = makeRecord({ status: "done" });
  const element = answerElement(render(detail, record, translateWith(ZH)));

  assert.equal(element.props.streaming, false);
});

test("the labels object is stable until the language changes", async () => {
  const detail = await loadDetail();
  const record = makeRecord({ status: "done" });
  const t = translateWith(ZH);

  const first = answerElement(render(detail, record, t));
  const second = answerElement(render(detail, record, t));
  assert.equal(first.props.labels, second.props.labels);

  const english = answerElement(render(detail, record, translateWith(EN)));
  assert.notEqual(english.props.labels, first.props.labels);
  assert.equal(english.props.labels.code.copyLabel, "Copy");
  assert.equal(english.props.labels.footnotes, "Footnotes");
});

test("an empty running answer shows the waiting state instead of the renderer", async () => {
  const detail = await loadDetail();
  const record = makeRecord({ answer: "" });
  const tree = render(detail, record, translateWith(ZH));

  assert.equal(answerElement(tree), null);
  assert.ok(hasWaitingPlaceholder(tree));
  // The copy names the request, not the model's thinking: the wait may be the
  // network, and the chat panel uses the same label before its first token.
  assert.ok(waitingRow(tree).children.includes("正在分析请求…"));
  // The dot sits in a fixed leading slot so the label starts on the same x as
  // the thinking row's title when the block replaces the wait.
  assert.ok(
    waitingRow(tree).children.some(
      (child) => child?.props?.className === "dqs-ask-waiting-icon",
    ),
  );
});

test("a running record with reasoning shows a collapsed thinking row", async () => {
  const detail = await loadDetail();
  const record = makeRecord({
    answer: "",
    reasoning: "first thought\nsecond line",
  });
  const tree = render(detail, record, translateWith(ZH));
  const row = thinkRow(tree);

  assert.notEqual(row, null);
  assert.equal(row.props.title, "思考");
  assert.equal(row.props.open, false);
  assert.equal(row.props.running, true);
  assert.equal(row.props.expandOnRowClick, true);
  assert.equal(summaryOf(row), "first thought");
  assert.equal(answerElement(tree), null);
  assert.equal(hasWaitingPlaceholder(tree), false);
});

test("a signature prefix hides reasoning until its visible text starts", async () => {
  const detail = await loadDetail();
  const t = translateWith(ZH);

  const hidden = render(
    detail,
    makeRecord({ answer: "", reasoning: "<signature>" }),
    t,
  );
  assert.equal(thinkRow(hidden), null);
  assert.ok(hasWaitingPlaceholder(hidden));

  const shown = render(
    detail,
    makeRecord({
      answer: "",
      reasoning: "<signature>opaque</signature>\nWhat the model thought",
      status: "done",
    }),
    t,
  );
  assert.equal(summaryOf(thinkRow(shown)), "What the model thought");
});

test("the collapsed summary follows the latest completed paragraph while running", async () => {
  const detail = await loadDetail();
  const record = makeRecord({
    answer: "",
    reasoning: "para one\n\n**para two** opener\nstill arriving",
  });

  const row = thinkRow(render(detail, record, translateWith(ZH)));
  // Bold markers are dropped because the row renders plain text, not Markdown.
  assert.equal(summaryOf(row), "para two opener");
});

test("a settled record summarizes from the opening line", async () => {
  const detail = await loadDetail();
  const record = makeRecord({
    answer: "answer",
    reasoning: "para one\n\npara two\nstill",
    status: "done",
  });

  const row = thinkRow(render(detail, record, translateWith(ZH)));
  assert.equal(row.props.running, false);
  assert.equal(summaryOf(row), "para one");
});

test("a finished record with reasoning keeps the block and the empty answer note", async () => {
  const detail = await loadDetail();
  const record = makeRecord({
    answer: "",
    reasoning: "thought",
    status: "done",
  });
  const tree = render(detail, record, translateWith(ZH));

  assert.notEqual(thinkRow(tree), null);
  assert.equal(answerElement(tree), null);
  assert.ok(
    find(
      tree,
      (node) =>
        node.props?.className === "dqs-ask-meta" && node.children?.[0] === "没有返回内容",
    ).length > 0,
  );
});

test("the thinking row follows the interface language", async () => {
  const detail = await loadDetail();
  const record = makeRecord({ answer: "", reasoning: "reasoning" });

  const english = thinkRow(render(detail, record, translateWith(EN)));
  assert.equal(english.props.title, "Think");
});

test("the expanded thinking body renders through the shared Markdown renderer", async () => {
  const detail = await loadDetail();
  const labels = { footnotes: "脚注", code: { copyLabel: "复制" } };
  const tree = detail.AskThinkingBlock({
    text: "first\nsecond **bold**",
    running: true,
    open: true,
    onToggle: () => {},
    t: translateWith(ZH),
    labels,
  });

  const row = find(tree, (node) => node.type === "DisclosureRow")[0];
  assert.equal(row.props.open, true);
  const markdown = find(tree, (node) => node.type === "MarkdownText")[0];
  assert.equal(markdown.props.text, "first\nsecond **bold**");
  assert.equal(markdown.props.streaming, true);
  assert.equal(markdown.props.variant, "compact");
  assert.equal(markdown.props.labels, labels);
});
