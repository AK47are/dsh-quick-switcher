/* Side-question detail and its action bar, rendered inside the switcher card. */

import React from "react";
import { formatUsage } from "../data/format.js";
import { renderMarkdown } from "../ask-markdown.js";
import { canCopy, canFork, canRegenerate, isRunning, statusLabelKey } from "../ask-store.js";

const h = React.createElement;

/**
 * One action in the detail bar: the panel's keycap plus a clickable label.
 *
 * The key reuses the keycap class the list footer already uses, so both bars
 * share one hint language and the panel font instead of the monospace `kbd`
 * default.
 */
function ActionButton({ label, keyLabel, shortcut, onClick, disabled }) {
  return h(
    "button",
    {
      type: "button",
      className: "dqs-ask-btn",
      disabled: disabled === true,
      "aria-keyshortcuts": shortcut,
      onClick,
    },
    h("kbd", { className: "dqs-keycap" }, keyLabel),
    h("span", null, label),
  );
}

/**
 * The answer for one record.
 *
 * The scroll container itself is focusable: after the panel sends a question
 * the caret lands here, so the browser's own arrow, page, home, and end keys
 * scroll the answer instead of the list behind it. The answer area is a
 * polite live region, so a screen reader hears the stream settle rather than
 * every token.
 *
 * Auto-follow only runs while the reader is already at the bottom. Scrolling up
 * to reread an earlier paragraph must not be undone by the next chunk.
 */
export function AskDetail({ record, t }) {
  const scrollRef = React.useRef(null);
  const followRef = React.useRef(true);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    try {
      node.focus({ preventScroll: true });
    } catch {
      node.focus();
    }
  }, []);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !followRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [record.answer, record.status]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (node === null) return;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const running = isRunning(record);
  const answer = record.answer;
  const usage = formatUsage(record.usage, t);
  const labelKey = statusLabelKey(record);

  const status = [];
  if (record.model !== "") {
    status.push(h("span", { key: "model", className: "dqs-ask-meta" }, record.model));
  }
  if (usage !== "") {
    status.push(h("span", { key: "usage", className: "dqs-ask-meta" }, usage));
  }
  if (labelKey !== null) {
    status.push(
      h("span", { key: "badge", className: "dqs-ask-badge" }, t(labelKey)),
    );
  }

  let body = null;
  if (running && answer === "") {
    body = h(
      "span",
      { className: "dqs-ask-thinking" },
      h("span", { className: "dqs-ask-dot", "aria-hidden": "true" }),
      t("askThinking"),
    );
  } else if (answer !== "") {
    body = renderMarkdown(answer);
  } else if (record.status === "done") {
    body = h("span", { className: "dqs-ask-meta" }, t("askEmptyAnswer"));
  }

  return h(
    "div",
    {
      className: "dqs-ask-detail",
      ref: scrollRef,
      tabIndex: 0,
      role: "group",
      "aria-label": t("askAnswerLabel"),
      onScroll,
    },
    status.length === 0
      ? null
      : h("div", { className: "dqs-ask-status" }, status),
    record.context === ""
      ? null
      : h(
          "details",
          { className: "dqs-ask-context" },
          h("summary", null, `${t("askContextAttached")}${record.contextLabel}`),
          h("pre", null, record.context),
        ),
    h(
      "div",
      {
        className: "dqs-ask-answer",
        "aria-live": "polite",
        "aria-busy": running ? "true" : "false",
      },
      body,
    ),
    record.error === null
      ? null
      : h(
          "div",
          { className: "dqs-ask-error", role: "alert" },
          h("div", { className: "dqs-ask-error-title" }, t("askFailed")),
          h("div", null, record.error),
        ),
  );
}

/**
 * The detail's action bar.
 *
 * It replaces the panel's default hints and count. Which buttons exist is
 * decided by the record's state, and every action is also reachable by letter,
 * so a keyboard user never has to tab here. The bar reuses the list footer's
 * keycap hints: actions on the left, the close hint on the right, and no
 * button frame of its own.
 */
export function AskFooter({ record, t, ui, actions }) {
  const running = isRunning(record);
  const buttons = [];
  if (running) {
    buttons.push(
      h(ActionButton, {
        key: "stop",
        label: t("askStop"),
        keyLabel: "S",
        shortcut: "s",
        onClick: actions.stop,
      }),
    );
  }
  if (!running && canCopy(record)) {
    const label = ui.copied
      ? t("askCopied")
      : ui.copyFailed
        ? t("askCopyFailed")
        : t("askCopy");
    buttons.push(
      h(ActionButton, {
        key: "copy",
        label,
        keyLabel: "C",
        shortcut: "c",
        onClick: actions.copy,
      }),
    );
  }
  if (!running && canRegenerate(record)) {
    buttons.push(
      h(ActionButton, {
        key: "regenerate",
        label: t("askRegenerate"),
        keyLabel: "R",
        shortcut: "r",
        onClick: actions.regenerate,
      }),
    );
  }
  if (!running && canFork(record)) {
    buttons.push(
      h(ActionButton, {
        key: "fork",
        label: ui.forking ? t("askForking") : t("askFork"),
        keyLabel: "F",
        shortcut: "f",
        onClick: actions.fork,
        disabled: ui.forking,
      }),
    );
  }
  buttons.push(
    h(ActionButton, {
      key: "back",
      label: t("askBack"),
      keyLabel: "I",
      shortcut: "i",
      onClick: actions.back,
    }),
  );

  // The actions sit side by side like the list footer's hints: the keycap and
  // the label inside each action, one gap between actions.
  return h(
    "div",
    { className: "dqs-ask-footer" },
    h("div", { className: "dqs-ask-actions" }, buttons),
    h(
      "span",
      { className: "dqs-ask-hint" },
      h("kbd", { className: "dqs-keycap" }, "Esc"),
      t("hintClose"),
    ),
  );
}
