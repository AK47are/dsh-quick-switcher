/* Content views and their footers get the translator of the module that
 * registered them, with the shared dictionary as the fallback. */

import assert from "node:assert/strict";
import test from "node:test";
import { viewTranslator } from "../src/core/panel/view-translator.js";

test("a view translates through the module that registered its kind", () => {
  const calls = [];
  const translate = (moduleId, key, params) => {
    calls.push({ moduleId, key, params });
    return `${moduleId}:${key}`;
  };
  const fallback = (key) => `core:${key}`;

  const t = viewTranslator(translate, fallback, { kind: "ask", moduleId: "ask" });
  assert.equal(t("askCopy"), "ask:askCopy");
  assert.deepEqual(calls, [{ moduleId: "ask", key: "askCopy", params: undefined }]);
});

test("a view translator forwards interpolation params", () => {
  const translate = (moduleId, key, params) => `${moduleId}/${key}/${params.count}`;
  const t = viewTranslator(translate, () => "core", { moduleId: "history" });

  assert.equal(t("countAsk", { count: 3 }), "history/countAsk/3");
});

test("a missing view keeps the shell translator", () => {
  const fallback = (key) => `core:${key}`;
  const t = viewTranslator(() => "module", fallback, null);

  assert.equal(t("coreMissingView"), "core:coreMissingView");
});
