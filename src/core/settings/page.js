/* Settings section generated from module declarations. */

import React from "react";

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
.dqs-settings-module {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
}
.dqs-settings-moduleTitle {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}
.dqs-settings-groupTitle {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
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
.dqs-settings-number {
  box-sizing: border-box;
  width: 96px;
  padding: 6px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  .dqs-settings-switch,
  .dqs-settings-switch::after {
    transition: none;
  }
}
`;

/**
 * Build the settings section.
 *
 * The page owns no preference logic: it reads the declarations the registry
 * collected, renders one section per module with the generic controls, and
 * writes through the same settings store the modules read. A new module with
 * settings appears here without touching this file.
 */
export function createSettingsSection({ settings, registry, t, tModule }) {
  return function SettingsSection() {
    const [, setRevision] = React.useState(0);
    React.useEffect(
      () => settings.subscribe(() => setRevision((value) => value + 1)),
      [],
    );
    const modules = registry.settingsGroups();
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
      modules.length === 0
        ? h("p", { className: "dqs-settings-description" }, t("settingsEmpty"))
        : modules.map((entry) =>
            h(ModuleBlock, {
              key: entry.moduleId,
              entry,
              settings,
              tModule,
            }),
          ),
    );
  };
}

function ModuleBlock({ entry, settings, tModule }) {
  const scope = settings.scope(entry.moduleId);
  return h(
    "section",
    { className: "dqs-settings-module" },
    h(
      "h3",
      { className: "dqs-settings-moduleTitle" },
      tModule(entry.moduleId, entry.settings.labelKey),
    ),
    entry.settings.descriptionKey === undefined
      ? null
      : h(
          "p",
          { className: "dqs-settings-description" },
          tModule(entry.moduleId, entry.settings.descriptionKey),
        ),
    entry.settings.groups.map((group, index) =>
      h(
        React.Fragment,
        { key: group.id ?? `group-${index}` },
        group.labelKey === undefined
          ? null
          : h(
              "h4",
              { className: "dqs-settings-groupTitle" },
              tModule(entry.moduleId, group.labelKey),
            ),
        group.fields.map((field) =>
          h(FieldRow, {
            key: field.id,
            moduleId: entry.moduleId,
            field,
            value: settings.get(entry.moduleId, field.id),
            set: (next) => scope.set(field.id, next),
            tModule,
          }),
        ),
      ),
    ),
  );
}

function FieldRow({ moduleId, field, value, set, tModule }) {
  const title = field.labelKey === undefined ? field.id : tModule(moduleId, field.labelKey);
  return h(
    "div",
    { className: "dqs-settings-row" },
    h(
      "div",
      { className: "dqs-settings-text" },
      h("div", { className: "dqs-settings-rowTitle" }, title),
      field.descriptionKey === undefined
        ? null
        : h(
            "p",
            { className: "dqs-settings-rowDescription" },
            tModule(moduleId, field.descriptionKey),
          ),
      field.hintKey === undefined
        ? null
        : h("p", { className: "dqs-settings-rowHint" }, tModule(moduleId, field.hintKey)),
    ),
    controlOf({ moduleId, field, value, set, title, tModule }),
  );
}

function controlOf({ moduleId, field, value, set, title, tModule }) {
  if (field.type === "boolean") {
    return h("button", {
      type: "button",
      role: "switch",
      "aria-checked": value === true,
      "aria-label": title,
      className: "dqs-settings-switch",
      onClick: () => set(!(value === true)),
    });
  }
  if (field.type === "choice") {
    return h(
      "div",
      { className: "dqs-settings-choices", role: "radiogroup", "aria-label": title },
      field.options.map((option) =>
        h(
          "label",
          { key: String(option.value), className: "dqs-settings-choice" },
          h("input", {
            type: "radio",
            name: `dqs-settings-${moduleId}-${field.id}`,
            value: String(option.value),
            checked: value === option.value,
            onChange: () => set(option.value),
          }),
          tModule(moduleId, option.labelKey),
        ),
      ),
    );
  }
  if (field.type === "number") {
    return h("input", {
      type: "number",
      className: "dqs-settings-number",
      "aria-label": title,
      value: value === undefined ? "" : String(value),
      min: field.min,
      max: field.max,
      step: field.step,
      onChange: (event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) set(next);
      },
    });
  }
  return field.render({
    field,
    value,
    set,
    t: (key, params) => tModule(moduleId, key, params),
  });
}
