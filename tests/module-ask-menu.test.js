import assert from "node:assert/strict";
import test from "node:test";
import {
  filterMenuItems,
  firstSelectableKey,
  lastSelectableKey,
  placeMenu,
  stepActiveKey,
} from "../src/modules/ask/menu.js";

/** A menu with the session row, two provider groups, and their models. */
function items() {
  return [
    { kind: "option", key: "", label: "Session model" },
    { kind: "header", key: "group:a", label: "Alpha" },
    { kind: "option", key: "a1", label: "Alpha One", group: "Alpha" },
    { kind: "option", key: "a2", label: "Alpha Two", group: "Alpha" },
    { kind: "header", key: "group:b", label: "Beta" },
    { kind: "option", key: "b1", label: "Beta One", group: "Beta" },
  ];
}

// Filtering.

test("an empty query keeps every row in order", () => {
  assert.deepEqual(filterMenuItems(items(), ""), items());
  assert.deepEqual(filterMenuItems(items(), "   "), items());
  assert.deepEqual(filterMenuItems(null, "x"), []);
});

test("a query keeps matches and only the header of a non-empty group", () => {
  assert.deepEqual(
    filterMenuItems(items(), "one").map((item) => item.key),
    ["group:a", "a1", "group:b", "b1"],
  );
  // A group with one match keeps its header and drops the other row.
  assert.deepEqual(
    filterMenuItems(items(), "two").map((item) => item.key),
    ["group:a", "a2"],
  );
  // A provider name matches every model in that group.
  assert.deepEqual(
    filterMenuItems(items(), "beta").map((item) => item.key),
    ["group:b", "b1"],
  );
  assert.deepEqual(filterMenuItems(items(), "missing"), []);
});

// Keyboard movement.

test("only options are selectable, headers are skipped", () => {
  assert.equal(firstSelectableKey(items()), "");
  assert.equal(lastSelectableKey(items()), "b1");
  assert.equal(firstSelectableKey([{ kind: "header", key: "h", label: "H" }]), null);
  assert.equal(lastSelectableKey([]), null);
});

test("the active row clamps at both ends and restarts from the edge", () => {
  assert.equal(stepActiveKey(items(), "a1", 1), "a2");
  // Moving down from a2 skips the Beta header.
  assert.equal(stepActiveKey(items(), "a2", 1), "b1");
  assert.equal(stepActiveKey(items(), "b1", 1), "b1");
  assert.equal(stepActiveKey(items(), "b1", -1), "a2");
  assert.equal(stepActiveKey(items(), "", -1), "");
  // A key that is no longer visible restarts from the edge it came from.
  assert.equal(stepActiveKey(items(), "gone", 1), "");
  assert.equal(stepActiveKey(items(), "gone", -1), "b1");
  assert.equal(stepActiveKey([], "a", 1), null);
  assert.equal(stepActiveKey(items(), "a1", 0), null);
});

// Placement.

const viewport = { width: 1000, height: 800 };

test("the menu opens below the trigger and follows its width", () => {
  const placement = placeMenu(
    { left: 100, top: 100, bottom: 128, width: 220 },
    viewport,
  );
  assert.deepEqual(placement, { left: 100, width: 240, top: 132, maxHeight: 360 });
});

test("the menu flips above when the lower side is too short", () => {
  const placement = placeMenu({ left: 100, top: 700, bottom: 728, width: 300 }, viewport);
  assert.equal(placement.maxHeight, 360);
  assert.equal(placement.top, undefined);
  // Anchored by its bottom edge: 800 - 700 + 4.
  assert.equal(placement.bottom, 104);
});

test("the menu stays inside the viewport on the right edge", () => {
  const placement = placeMenu({ left: 900, top: 100, bottom: 128, width: 220 }, viewport);
  assert.equal(placement.width, 240);
  assert.equal(placement.left, 752);
});

test("a malformed anchor falls back to the margin", () => {
  assert.deepEqual(placeMenu(null, viewport), {
    left: 8,
    top: 0,
    width: 240,
    maxHeight: 360,
  });
});
