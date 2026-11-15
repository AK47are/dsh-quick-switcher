/* Settings section for the side question's attachment preference. */

import React from "react";
import { preferences } from "../preferences.js";

const h = React.createElement;

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
@media (prefers-reduced-motion: reduce) {
  .dqs-settings-switch,
  .dqs-settings-switch::after {
    transition: none;
  }
}
`;

/**
 * Settings page for the side question. The shell owns the panel chrome and
 * navigation; this component renders the one preference this plugin owns.
 */
export function SettingsSection({ t, preferences: store = preferences }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const included = state.includeAttachments;
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
