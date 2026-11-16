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

const ZH = {
  askCodeCopy: "复制",
  askCodeCopied: "已复制",
  askCodeTitle: "代码",
  askCodeWrap: "自动换行",
  askCodeUnwrap: "取消换行",
  askFootnotes: "脚注",
  askStatusRunning: "运行中",
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

test("an empty running answer shows the thinking state instead of the renderer", async () => {
  const detail = await loadDetail();
  const record = makeRecord({ answer: "" });
  const tree = render(detail, record, translateWith(ZH));

  assert.equal(answerElement(tree), null);
  assert.ok(find(tree, (node) => node.props?.className === "dqs-ask-thinking").length > 0);
});
