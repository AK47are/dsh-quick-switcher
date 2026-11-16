import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "../src/core/i18n.js";

function localeOf(active) {
  return { getSnapshot: () => ({ active }) };
}

const core = {
  zh: { title: "标题", hintClose: "关闭", count: "{count} 条" },
  en: { title: "Title", hintClose: "Close", count: "{count} items" },
};

test("the module dictionary wins over the core dictionary", () => {
  const translator = createTranslator({ locale: localeOf("zh"), dictionaries: core });
  translator.add("alpha", { zh: { title: "甲" }, en: { title: "Alpha" } });
  assert.equal(translator.t("alpha", "title"), "甲");
  assert.equal(translator.t("alpha", "hintClose"), "关闭");
  assert.equal(translator.t(null, "title"), "标题");
});

test("an unsupported language falls back through en and zh", () => {
  const translator = createTranslator({ locale: localeOf("fr"), dictionaries: core });
  translator.add("alpha", { zh: { only: "只有中文" } });
  assert.equal(translator.t("alpha", "title"), "Title");
  assert.equal(translator.t("alpha", "only"), "只有中文");
});

test("a regional tag falls back to its base language before en", () => {
  const translator = createTranslator({ locale: localeOf("zh-CN"), dictionaries: core });
  translator.add("alpha", { zh: { title: "甲" } });
  assert.equal(translator.t("alpha", "title"), "甲");
});

test("parameters are interpolated and unknown placeholders stay visible", () => {
  const translator = createTranslator({ locale: localeOf("en"), dictionaries: core });
  assert.equal(translator.t(null, "count", { count: 3 }), "3 items");
  assert.equal(translator.t(null, "count"), "{count} items");
  assert.equal(
    translator.t(null, "count", { count: 1, extra: 2 }),
    "1 items",
  );
});

test("a missing key returns the key itself", () => {
  const translator = createTranslator({ locale: localeOf("en"), dictionaries: core });
  assert.equal(translator.t(null, "missing"), "missing");
  assert.equal(translator.t("alpha", "missing"), "missing");
});

test("adding a dictionary twice and removing it are both explicit", () => {
  const translator = createTranslator({ locale: localeOf("en"), dictionaries: core });
  const remove = translator.add("alpha", { en: { title: "Alpha" } });
  assert.throws(() => translator.add("alpha", { en: {} }), /already registered/);
  remove();
  assert.equal(translator.t("alpha", "title"), "Title");
});

test("a broken locale service falls back to en instead of throwing", () => {
  const translator = createTranslator({
    locale: {
      getSnapshot() {
        throw new Error("boom");
      },
    },
    dictionaries: core,
  });
  assert.equal(translator.t(null, "title"), "Title");
});
