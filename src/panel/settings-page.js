/* Settings section for the switcher's browser preferences. */

import React from "react";
import {
  PENDING_ORDER_LEAST_RECENT,
  PENDING_ORDER_MOST_RECENT,
} from "../data/pending-order.js";
import { preferences } from "../preferences.js";

const h = React.createElement;

/** The pending group's two orders, in the order the row lists them. */
const PENDING_ORDER_CHOICES = [
  { value: PENDING_ORDER_LEAST_RECENT, labelKey: "settingsPendingOrderLeastRecent" },
  { value: PENDING_ORDER_MOST_RECENT, labelKey: "settingsPendingOrderMostRecent" },
];

const STYLE = `
.dqs-settings-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dqs-settings-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
}
.dqs-settings-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.dqs-settings-description {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-settings-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dqs-settings-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding-right: 48px;
}
.dqs-settings-rowTitle {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
}
.dqs-settings-rowDescription,
.dqs-settings-rowHint {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-settings-rowHint {
  color: var(--dsw-alias-label-tertiary);
}
.dqs-settings-switch {
  position: relative;
  flex: none;
  width: 40px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  cursor: pointer;
  transition: background-color 120ms ease;
}
.dqs-settings-switch[aria-checked="true"] {
  background: var(--dsw-alias-state-business-primary);
}
.dqs-settings-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base);
  transition: transform 120ms ease;
}
.dqs-settings-switch[aria-checked="true"]::after {
  transform: translateX(16px);
}
.dqs-settings-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dqs-settings-choices {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
}
.dqs-settings-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dqs-settings-choice input {
  flex: none;
  margin: 0;
  accent-color: var(--dsw-alias-state-business-primary);
}
@media (prefers-reduced-motion: reduce) {
  .dqs-settings-switch,
  .dqs-settings-switch::after {
    transition: none;
  }
}
`;

/**
 * One row per preference. The shell owns the panel chrome and navigation; the
 * rows below explain their own behavior because the panel list has no room for
 * that copy and the rule only matters while choosing an option.
 */
export function SettingsSection({ t, preferences: store = preferences }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const included = state.includeAttachments;
  const pendingOrder = state.pendingOrder;
  return h(
    "div",
    { className: "dqs-settings-page" },
    h("style", null, STYLE),
    h(
      "div",
      { className: "dqs-settings-heading" },
      h("h2", { className: "dqs-settings-title" }, t("settingsTitle")),
      h("p", { className: "dqs-settings-description" }, t("settingsDescription")),
    ),
    h(
      "div",
      { className: "dqs-settings-row" },
      h(
        "div",
        { className: "dqs-settings-text" },
        h("div", { className: "dqs-settings-rowTitle" }, t("settingsPendingOrderTitle")),
        h("p", { className: "dqs-settings-rowDescription" }, t("settingsPendingOrderDescription")),
        h("p", { className: "dqs-settings-rowHint" }, t("settingsPendingOrderHint")),
      ),
      h(
        "div",
        {
          className: "dqs-settings-choices",
          role: "radiogroup",
          "aria-label": t("settingsPendingOrderTitle"),
        },
        PENDING_ORDER_CHOICES.map((choice) =>
          h(
            "label",
            { key: choice.value, className: "dqs-settings-choice" },
            h("input", {
              type: "radio",
              name: "dqs-pending-order",
              value: choice.value,
              checked: pendingOrder === choice.value,
              onChange: () => store.setPendingOrder(choice.value),
            }),
            t(choice.labelKey),
          ),
        ),
      ),
    ),
    h(
      "div",
      { className: "dqs-settings-row" },
      h(
        "div",
        { className: "dqs-settings-text" },
        h("div", { className: "dqs-settings-rowTitle" }, t("settingsAttachmentsTitle")),
        h("p", { className: "dqs-settings-rowDescription" }, t("settingsAttachmentsDescription")),
        h("p", { className: "dqs-settings-rowHint" }, t("settingsAttachmentsHint")),
      ),
      h("button", {
        type: "button",
        role: "switch",
        "aria-checked": included,
        "aria-label": t("settingsAttachmentsTitle"),
        className: "dqs-settings-switch",
        onClick: () => store.setIncludeAttachments(!included),
      }),
    ),
  );
}
