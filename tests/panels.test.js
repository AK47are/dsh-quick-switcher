import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPanelEntries,
  createPanelStore,
  resolvePanelLabel,
} from "../src/modules/panels/logic.js";
import { createPanelsRoute } from "../src/routes/panels.js";

/** Registrations shaped like the slot entries the sidebar also reads. */
const registrations = [
  { options: { id: "schedules", order: 10, label: () => "自动化任务" } },
  { options: { id: "plugins", order: 0, label: () => "插件" } },
];

const t = (key, vars) => (vars === undefined ? key : `${key}:${vars.count}`);

function context(panelEntries, activePanelId = null) {
  return { panelEntries, activePanelId, t };
}

test("labels resolve from strings, functions, and language maps", () => {
  assert.equal(resolvePanelLabel("插件"), "插件");
  assert.equal(resolvePanelLabel("  插件  "), "插件");
  assert.equal(resolvePanelLabel(() => "Automation tasks"), "Automation tasks");
  assert.equal(resolvePanelLabel({ zh: "插件", en: "Plugins" }, "en"), "Plugins");
  assert.equal(resolvePanelLabel({ zh: "插件", en: "Plugins" }, "de"), "插件");
  assert.equal(resolvePanelLabel({ ja: "プラグイン" }, "de"), "プラグイン");
  assert.equal(resolvePanelLabel(undefined), "");
  assert.equal(resolvePanelLabel(42), "");
});

test("a throwing or empty label never takes the list down", () => {
  assert.equal(
    resolvePanelLabel(() => {
      throw new Error("boom");
    }),
    "",
  );
  assert.equal(resolvePanelLabel(() => ""), "");
  assert.equal(resolvePanelLabel({ zh: "   " }), "");
});

test("entries follow registration order and fall back to the id", () => {
  const entries = collectPanelEntries(registrations);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["plugins", "schedules"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["插件", "自动化任务"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.idText),
    ["plugins", "schedules"],
  );
  assert.equal(entries[0].metaLower, "plugins");
  assert.equal(entries[0].titleLower, "插件");
});

test("equal orders keep their arrival order and duplicate ids collapse", () => {
  const entries = collectPanelEntries([
    { options: { id: "b", label: "B" } },
    { options: { id: "a", label: "A" } },
    { options: { id: "b", label: "B again" } },
    { options: { id: "", label: "nameless" } },
    { options: { label: "no id" } },
  ]);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["b", "a"],
  );
  assert.equal(entries[0].title, "B");
});

test("a label equal to the id does not repeat it under the title", () => {
  const [entry] = collectPanelEntries([{ options: { id: "plugins" } }]);
  assert.equal(entry.title, "plugins");
  assert.equal(entry.idText, "");
});

test("the panel store notifies only when the rows really change", () => {
  let next = collectPanelEntries(registrations);
  let calls = 0;
  const store = createPanelStore(() => next);
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.refresh();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().length, 2);

  next = collectPanelEntries(registrations);
  store.refresh();
  assert.equal(calls, 1, "an equal list must not re-render the overlay");

  next = collectPanelEntries([
    ...registrations,
    { options: { id: "third", order: 20, label: "Third" } },
  ]);
  store.refresh();
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().length, 3);

  unsubscribe();
  next = collectPanelEntries([]);
  store.refresh();
  assert.equal(calls, 2);
  assert.deepEqual(store.getSnapshot(), []);
});

