/* Side-question detail and its action bar, rendered inside the switcher card. */

import React from "react";
import { formatUsage } from "../../core/lib/format.js";
import { canCopy, canFork, canRegenerate, isRunning, statusLabelKey } from "./logic.js";
import { renderMarkdown } from "./markdown.js";

const h = React.createElement;

/** Stable no-op used while the mount surface is missing a subscription. */
function noopSubscribe() {
  return () => {};
}

/**
 * Read one record from the mount's store.
 *
 * The store replaces a record object on every patch, so the snapshot is stable
 * between notifications and React can tear-free re-read it while an answer
 * streams. A missing store (a mount that never published one) resolves null
 * instead of throwing, which keeps one broken surface from taking the panel
 * down; the shell still renders what the view returned.
 */
function useAskRecord(instance, id) {
  const store = instance !== null && typeof instance === "object" ? instance.store : null;
  const subscribe = React.useCallback(
    (listener) =>
      typeof store?.subscribe === "function" ? store.subscribe(listener) : noopSubscribe(),
    [store],
  );
  const getSnapshot = React.useCallback(
    () => (typeof store?.find === "function" ? store.find(id) : null),
    [store, id],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot);
}

/** Read the mount's copy and fork feedback snapshot. */
function useAskUi(instance) {
  const ui = instance !== null && typeof instance === "object" ? instance.ui : null;
  const subscribe = React.useCallback(
    (listener) =>
      typeof ui?.subscribe === "function" ? ui.subscribe(listener) : noopSubscribe(),
    [ui],
  );
  const getSnapshot = React.useCallback(
    () => (typeof ui?.getSnapshot === "function" ? ui.getSnapshot() : NO_UI),
    [ui],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot);
}

/** What the footer reads before or without a mount ui store. */
const NO_UI = Object.freeze({ copied: false, copyFailed: false, forking: false });

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
export function AskDetail({ descriptor, instance, t }) {
  const id = descriptor?.props?.id ?? null;
  const record = useAskRecord(instance, id);
  const answer = record === null ? "" : record.answer;
  const status = record === null ? "" : record.status;

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
  }, [answer, status]);

  if (record === null) return null;

  const onScroll = () => {
    const node = scrollRef.current;
    if (node === null) return;
    followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  const running = isRunning(record);
  const usage = formatUsage(record.usage, t);
  const labelKey = statusLabelKey(record);

  const badges = [];
  if (record.model !== "") {
    badges.push(h("span", { key: "model", className: "dqs-ask-meta" }, record.model));
  }
  // The host names the level it actually ran, so a floored request shows the
  // level behind the answer instead of the one the user picked.
  if (typeof record.effort === "string" && record.effort !== "") {
    const effort =
      typeof record.effortName === "string" && record.effortName !== ""
        ? record.effortName
        : record.effort;
    badges.push(h("span", { key: "effort", className: "dqs-ask-meta" }, effort));
  }
  if (usage !== "") {
    badges.push(h("span", { key: "usage", className: "dqs-ask-meta" }, usage));
  }
  if (labelKey !== null) {
    badges.push(
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
    badges.length === 0
      ? null
      : h("div", { className: "dqs-ask-status" }, badges),
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
 *
 * Copy feedback comes from the mount ui store, and a record id or status change
 * clears it: a new answer makes an earlier "Copied" a lie.
 */
export function AskFooter({ descriptor, instance, panel, t }) {
  const id = descriptor?.props?.id ?? null;
  const record = useAskRecord(instance, id);
  const ui = useAskUi(instance);
  const actions =
    instance !== null && typeof instance === "object" ? instance.actions : null;

  const recordId = record === null ? null : record.id;
  const recordStatus = record === null ? null : record.status;
  React.useEffect(() => {
    if (instance !== null && typeof instance === "object") {
      instance.ui?.clearCopy?.();
    }
  }, [instance, recordId, recordStatus]);

  if (record === null || actions === null || actions === undefined) return null;

  const running = isRunning(record);
  const buttons = [];
  if (running) {
    buttons.push(
      h(ActionButton, {
        key: "stop",
        label: t("askStop"),
        keyLabel: "S",
        shortcut: "s",
        onClick: () => actions.stop(record),
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
        onClick: () => {
          void actions.copy(record);
        },
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
        onClick: () => actions.regenerate(record),
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
        onClick: () => {
          void actions.fork(record);
        },
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
      onClick: () => actions.back(panel),
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
