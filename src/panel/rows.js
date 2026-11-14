/* Generic row rendering for the panel shell. */

import React from "react";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";

const h = React.createElement;

export function Keycap({ children }) {
  return h("kbd", { className: "dqs-keycap" }, children);
}

/**
 * Render one effective shortcut binding.
 *
 * DSH already formats the labels for the current platform, including turning
 * the modifier separator into its own "+" entry on Windows. That separator is
 * punctuation rather than a key, so it renders as text instead of a keycap.
 */
export function Keycaps({ keys }) {
  return h(
    "span",
    { className: "dqs-keys" },
    keys.map((key, index) =>
      key === "+"
        ? h(
            "span",
            { key: index, className: "dqs-key-sep", "aria-hidden": true },
            "+",
          )
        : h(Keycap, { key: index }, key),
    ),
  );
}

export function SearchGlyph() {
  return h(
    "svg",
    {
      className: "dqs-search-icon",
      viewBox: "0 0 20 20",
      width: 18,
      height: 18,
      "aria-hidden": true,
    },
    h("circle", {
      cx: 8.5,
      cy: 8.5,
      r: 5.25,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
    }),
    h("path", {
      d: "m12.4 12.4 4.1 4.1",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
  );
}

export function CloseGlyph() {
  return h(
    "svg",
    { viewBox: "0 0 20 20", width: 16, height: 16, "aria-hidden": true },
    h("path", {
      d: "m5 5 10 10M15 5 5 15",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
  );
}

/**
 * The sidebar's own state dot primitive: the ongoing state is its animated
 * ring, so this panel inherits every future shape and color change instead
 * of maintaining a second spinner.
 */
export function SessionStatusDot({ state, label }) {
  return h(
    "span",
    {
      className: "dqs-state",
      role: "img",
      title: label,
      "aria-label": label,
    },
    h(primitives.StateDot, { state }),
  );
}

/** Render a title with the matched characters wrapped in `mark`. */
export function highlightTitle(text, positions) {
  if (!positions || positions.size === 0) return text;
  const sorted = [...positions].sort((left, right) => left - right);
  const parts = [];
  let start = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const position = sorted[index];
    let end = position + 1;
    while (index + 1 < sorted.length && sorted[index + 1] === end) {
      end += 1;
      index += 1;
    }
    if (position > start) parts.push(text.slice(start, position));
    parts.push(
      h(
        "mark",
        { key: `mark-${position}`, className: "dqs-mark" },
        text.slice(position, end),
      ),
    );
    start = end;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/**
 * One row in the active route's list.
 *
 * A route decides what to show by filling the uniform row shape; the panel
 * only owns selection, icons, status, badges, click dispatch, and the Alt+digit
 * hint on the first nine rows.
 *
 * Hover is reported as `pointermove` rather than `mouseenter`: the browser
 * replays enter events for elements that appear under a stationary pointer,
 * so an enter-driven selection would follow the layout instead of the user.
 * The panel decides whether a move is real; the row only reports it.
 */
export function RowView({ row, selected, index, onPointerMove, onActivate, registerRef }) {
  const className = ["dqs-row", selected ? "dqs-row-selected" : "", row.className ?? ""]
    .filter(Boolean)
    .join(" ");
  const titleClassName = ["dqs-title", row.titleClassName ?? ""].filter(Boolean).join(" ");
  const meta = row.meta ?? [];
  return h(
    "div",
    {
      id: `dqs-option-${index}`,
      role: "option",
      "aria-selected": selected ? "true" : "false",
      "aria-keyshortcuts": index < 9 ? `Alt+${index + 1}` : undefined,
      className,
      ref: registerRef,
      onPointerMove,
      onMouseDown: (event) => event.preventDefault(),
      onClick: (event) => onActivate(event.shiftKey),
    },
    h(
      "div",
      { className: row.icon ? "dqs-row-main dqs-create-main" : "dqs-row-main" },
      row.icon
        ? h("span", { className: "dqs-create-icon", "aria-hidden": "true" }, row.icon)
        : null,
      h("div", { className: titleClassName }, highlightTitle(row.title, row.positions)),
      meta.length === 0
        ? null
        : h(
            "div",
            { className: "dqs-meta" },
            meta.map((item, metaIndex) =>
              h("span", { key: metaIndex, className: item.className }, item.text),
            ),
          ),
    ),
    h(
      "div",
      { className: "dqs-status" },
      row.keys && row.keys.length > 0 ? h(Keycaps, { keys: row.keys }) : null,
      row.status
        ? h(SessionStatusDot, { state: row.status.state, label: row.status.label })
        : null,
      row.badge ? h("span", { className: "dqs-badge" }, row.badge) : null,
      row.trailing ? h("span", { className: "dqs-trailing" }, row.trailing) : null,
      index < 9
        ? h(
            "span",
            { className: "dqs-jump", "aria-hidden": "true" },
            `Alt ${index + 1}`,
          )
        : null,
    ),
  );
}
