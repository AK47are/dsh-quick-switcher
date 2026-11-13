import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPanelEntries,
  createPanelStore,
  resolvePanelLabel,
} from "../src/data/panels.js";
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

test("only a leading # claims the query", () => {
  const route = createPanelsRoute();
  assert.deepEqual(route.parse("#"), { filter: "" });
  assert.deepEqual(route.parse("#plu"), { filter: "plu" });
  assert.equal(route.parse("plu"), null);
  assert.equal(route.parse("a#b"), null);
});

test("the panel route lists every registration in order", () => {
  const route = createPanelsRoute();
  const entries = collectPanelEntries(registrations);
  const view = route.view(route.parse("#"), context(entries));
  assert.deepEqual(
    view.rows.map((row) => row.key),
    ["p:plugins", "p:schedules"],
  );
  assert.equal(view.placeholder, "placeholderPanels");
  assert.equal(view.count, "countPanels:2");
  assert.deepEqual(view.rows[0].meta, [
    { text: "plugins", className: "dqs-panel-id" },
  ]);
  assert.equal(view.rows[0].badge, undefined);
});

test("panel search matches the label first and the id second", () => {
  const route = createPanelsRoute();
  const entries = collectPanelEntries(registrations);

  const byLabel = route.view(route.parse("#插件"), context(entries));
  assert.deepEqual(
    byLabel.rows.map((row) => row.key),
    ["p:plugins"],
  );
  assert.ok(byLabel.rows[0].positions.size > 0);

  const byId = route.view(route.parse("#sched"), context(entries));
  assert.deepEqual(
    byId.rows.map((row) => row.key),
    ["p:schedules"],
  );
  assert.equal(byId.rows[0].positions.size, 0);
});

test("the current panel is badged and Enter closes instead of reopening it", () => {
  const route = createPanelsRoute();
  const entries = collectPanelEntries(registrations);
  const view = route.view(route.parse("#"), context(entries, "plugins"));

  const opened = [];
  const activation = {
    openPanel(id) {
      opened.push(id);
      return true;
    },
  };

  assert.equal(view.rows[0].badge, "current");
  assert.deepEqual(view.rows[0].run(activation), {
    type: "close",
    restoreFocus: true,
  });
  assert.deepEqual(opened, []);

  assert.deepEqual(view.rows[1].run(activation), {
    type: "close",
    restoreFocus: false,
  });
  assert.deepEqual(opened, ["schedules"]);
});

test("a refused panel keeps the overlay open and yields no effect", () => {
  const route = createPanelsRoute();
  const entries = collectPanelEntries(registrations);
  const view = route.view(route.parse("#"), context(entries));
  assert.equal(
    view.rows[0].run({ openPanel: () => false }),
    undefined,
  );
});

test("the route tells an empty registry from an empty match", () => {
  const route = createPanelsRoute();
  assert.equal(route.view(route.parse("#"), context([])).emptyText, "emptyPanels");
  const entries = collectPanelEntries(registrations);
  assert.equal(
    route.view(route.parse("#zzz"), context(entries)).emptyText,
    "emptyPanelMatches",
  );
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
