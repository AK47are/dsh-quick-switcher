/* Settings section generated from module declarations and switcher state. */

import React from "react";
import { buildSettingsModel } from "./model.js";

const h = React.createElement;

const STYLE = `
.dqs-settings-page {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dqs-settings-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 4px;
}
.dqs-settings-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}
.dqs-settings-description {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 17px;
}
.dqs-settings-sectionHeading {
  margin: 0;
}
.dqs-settings-sectionButton {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  margin-left: -4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dqs-settings-sectionButton:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dqs-settings-sectionButton:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dqs-settings-chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}
.dqs-settings-chevronOpen {
  transform: rotate(90deg);
}
.dqs-settings-summary {
  margin-left: auto;
  padding-left: 8px;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dqs-settings-sectionBody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
}
.dqs-settings-moduleTitle {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.dqs-settings-groupTitle {
  margin: 2px 0 0;
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
  gap: 16px;
  padding: 10px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dqs-settings-rowStack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.dqs-settings-rowStack .dqs-settings-text {
  padding-right: 0;
}
.dqs-settings-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-right: 24px;
}
.dqs-settings-rowTitle {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 19px;
}
.dqs-settings-rowDescription,
.dqs-settings-rowHint,
.dqs-settings-warning {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 17px;
}
.dqs-settings-rowHint {
  color: var(--dsw-alias-label-tertiary);
}
.dqs-settings-warning {
  color: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-secondary));
}
.dqs-settings-tag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
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
.dqs-settings-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dqs-settings-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}
.dqs-settings-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dqs-settings-pill[data-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dqs-settings-pill:focus-within {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dqs-settings-pillInput {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.dqs-settings-choices {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
}
.dqs-settings-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
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
  padding: 5px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
@media (prefers-reduced-motion: reduce) {
  .dqs-settings-switch,
  .dqs-settings-switch::after,
  .dqs-settings-chevron {
    transition: none;
  }
}
`;

/**
 * Build the settings section.
 *
 * The page owns no preference logic: it reads the model built from module
 * declarations and the core switches, then writes through the same settings
 * store the modules read. A module registered or switched off while the page is
 * open re-renders through the registry subscription, and a switch recorded in
 * another tab arrives through the store subscription.
 */
export function createSettingsSection({ settings, registry, t, tModule }) {
  return function SettingsSection() {
    const [, setRevision] = React.useState(0);
    React.useEffect(
      () => settings.subscribe(() => setRevision((value) => value + 1)),
      [],
    );
    React.useEffect(
      () => registry.subscribe(() => setRevision((value) => value + 1)),
      [registry],
    );
    const model = buildSettingsModel({ registry, settings, t, tModule });
    const empty = model.modules.length === 0 && model.groups.length === 0;
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
      empty
        ? h("p", { className: "dqs-settings-description" }, t("settingsEmpty"))
        : null,
      model.modules.length === 0
        ? null
        : h(ModuleSwitches, { modules: model.modules, settings, t }),
      model.general.defaultMode.options.length === 0
        ? null
        : h(DefaultMode, { general: model.general, settings, t }),
      model.groups.map((entry) => h(ModuleBlock, { key: entry.moduleId, entry, settings, t, tModule })),
    );
  };
}

/**
 * A disclosure header shared by the module list, the general settings and each
 * module's preferences. The open state lives in the settings store, so a
 * section stays collapsed after leaving the page or reloading, and another tab
 * sees the same layout.
 */
function SectionToggle({ id, title, summary, tag, settings, children }) {
  const isOpen = settings.isSectionExpanded(id);
  return h(
    "section",
    { className: "dqs-settings-section" },
    h(
      "h3",
      { className: "dqs-settings-sectionHeading" },
      h(
        "button",
        {
          type: "button",
          className: "dqs-settings-sectionButton",
          "aria-expanded": isOpen,
          onClick: () => settings.setSectionExpanded(id, !isOpen),
        },
        h(Chevron, { isOpen }),
        h("span", { className: "dqs-settings-moduleTitle" }, title),
        tag === null || tag === undefined
          ? null
          : h("span", { className: "dqs-settings-tag" }, tag),
        summary === null || summary === undefined
          ? null
          : h("span", { className: "dqs-settings-summary" }, summary),
      ),
    ),
    isOpen
      ? h(
          "div",
          { className: "dqs-settings-sectionBody" },
          ...(Array.isArray(children) ? children : [children]),
        )
      : null,
  );
}

function Chevron({ isOpen }) {
  return h(
    "svg",
    {
      className: isOpen
        ? "dqs-settings-chevron dqs-settings-chevronOpen"
        : "dqs-settings-chevron",
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M4.5 2.5 L8 6 L4.5 9.5",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

function ModuleSwitches({ modules, settings, t }) {
  const offCount = modules.filter((module) => !module.isEnabled).length;
  const summary =
    offCount === 0
      ? t("settingsModulesCount", { count: modules.length })
      : `${t("settingsModulesCount", { count: modules.length })} · ${t(
          "settingsModulesOffCount",
          { count: offCount },
        )}`;
  return h(
    SectionToggle,
    {
      id: "modules",
      title: t("settingsModulesTitle"),
      summary,
      settings,
    },
    h("p", { className: "dqs-settings-description" }, t("settingsModulesDescription")),
    modules.map((module) => h(ModuleSwitchRow, { key: module.id, module, settings, t })),
  );
}

function ModuleSwitchRow({ module, settings, t }) {
  return h(
    "div",
    { className: "dqs-settings-row" },
    h(
      "div",
      { className: "dqs-settings-text" },
      h("div", { className: "dqs-settings-rowTitle" }, module.title),
      h("p", { className: "dqs-settings-rowDescription" }, module.description),
      module.warnings.map((warning, index) =>
        h("p", { key: `warning-${index}`, className: "dqs-settings-warning" }, warning),
      ),
    ),
    h("button", {
      type: "button",
      role: "switch",
      "aria-checked": module.isEnabled,
      "aria-label": module.title,
      className: "dqs-settings-switch",
      onClick: () => settings.setModuleSwitch(module.id, !module.isEnabled),
    }),
  );
}

function DefaultMode({ general, settings, t }) {
  const { value, options, warning } = general.defaultMode;
  const selectedOption = options.find((option) => option.value === value);
  const summary =
    selectedOption === undefined
      ? warning === null
        ? null
        : t("settingsDefaultModeUnavailableShort")
      : selectedOption.isEnabled
        ? selectedOption.label
        : t("settingsOptionOff", { label: selectedOption.label });
  return h(
    SectionToggle,
    { id: "general", title: t("settingsGeneralTitle"), summary, settings },
    h(
      "div",
      { className: "dqs-settings-row dqs-settings-rowStack" },
      h(
        "div",
        { className: "dqs-settings-text" },
        h("div", { className: "dqs-settings-rowTitle" }, t("settingsDefaultModeTitle")),
        h(
          "p",
          { className: "dqs-settings-rowDescription" },
          t("settingsDefaultModeDescription"),
        ),
        warning === null
          ? null
          : h("p", { className: "dqs-settings-warning" }, warning),
      ),
      h(
        "div",
        {
          className: "dqs-settings-pills",
          role: "radiogroup",
          "aria-label": t("settingsDefaultModeTitle"),
        },
        options.map((option) => {
          const selected = value === option.value;
          return h(
            "label",
            {
              key: option.value,
              className: "dqs-settings-pill",
              "data-selected": selected ? "true" : "false",
              // The input is visually hidden, so this handler also covers a
              // click on the pill text and pins the checked option.
              onClick: () => settings.setDefaultMode(option.value),
            },
            h("input", {
              type: "radio",
              className: "dqs-settings-pillInput",
              name: "dqs-settings-default-mode",
              value: option.value,
              checked: selected,
              // Clicking the checked pill (the effective first entry while the
              // preference is unset) has no change event, so the click pins
              // the shown choice instead of leaving it implicit.
              onClick: () => settings.setDefaultMode(option.value),
              onChange: () => settings.setDefaultMode(option.value),
            }),
            h(
              "span",
              null,
              option.isEnabled
                ? option.label
                : t("settingsOptionOff", { label: option.label }),
            ),
          );
        }),
      ),
    ),
  );
}

function ModuleBlock({ entry, settings, t, tModule }) {
  const scope = settings.scope(entry.moduleId);
  return h(
    SectionToggle,
    {
      id: `module:${entry.moduleId}`,
      title: tModule(entry.moduleId, entry.settings.labelKey),
      tag: entry.isEnabled ? null : t("settingsModuleOff"),
      settings,
    },
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
