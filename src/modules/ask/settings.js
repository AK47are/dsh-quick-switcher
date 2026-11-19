/* Settings controls for the side-question model, reasoning effort, and records. */

import React from "react";
import {
  LOWEST_EFFORT,
  createCatalogLoader,
  effortsForChoice,
  hasModel,
  modelKey,
  modelOptionEntries,
  readChoice,
  splitModelKey,
} from "./models.js";
import { Picker } from "./picker.js";
import {
  ASK_RECORD_LIMIT_DEFAULT_BYTES,
  ASK_RECORD_LIMIT_MAX_BYTES,
  askRecordLimitBytesOfMegabytes,
  formatAskRecordSize,
  projectAskRecordCount,
  readAskRecordLimit,
  referenceAskRecordWeigh,
  trimAskRecordsToLimit,
  weighAskRecords,
} from "./storage.js";

const h = React.createElement;

/** How long the clear button stays armed before it goes back to its label. */
const CLEAR_CONFIRM_MS = 5000;

/** The largest cap the number input offers, in megabytes. */
const MAX_LIMIT_MB = ASK_RECORD_LIMIT_MAX_BYTES / (1024 * 1024);

/** Render a byte cap as the megabytes the input shows; empty means no cap. */
function limitTextOf(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const megabytes = bytes / (1024 * 1024);
  return Number.isInteger(megabytes) ? String(megabytes) : String(Number(megabytes.toFixed(3)));
}

/**
 * Styles for the custom controls.
 *
 * They live in the module because the core settings page only styles its own
 * generic controls; a custom renderer owns its look the same way the ask detail
 * owns its answer typography. The trigger and menu themselves are styled by the
 * picker, so this block only holds the column, the inline notes, the record
 * meter, and the clear action. The record control opts into the stacked row
 * through its field declaration, so its classes also size it for the full row.
 */
const STYLE = `
.dqs-ask-control {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 220px;
  max-width: 100%;
}
.dqs-ask-record {
  gap: 10px;
}
.dqs-settings-rowStack .dqs-ask-record {
  width: 100%;
}
.dqs-ask-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
}
.dqs-ask-record .dqs-ask-note {
  text-align: left;
}
.dqs-ask-recordRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dqs-ask-recordLabel {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-number {
  box-sizing: border-box;
  width: 96px;
  padding: 5px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  appearance: textfield;
  -moz-appearance: textfield;
}
.dqs-ask-number::-webkit-outer-spin-button,
.dqs-ask-number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.dqs-ask-number:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
.dqs-ask-unit {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-meter {
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-interactive-bg-hover);
  overflow: hidden;
}
.dqs-ask-meterFill {
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary);
  transition: width 160ms ease;
}
.dqs-ask-meterFill[data-over="true"] {
  background: var(--dsw-alias-state-error-primary);
}
.dqs-ask-usage {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-estimate {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-over {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-invalid {
  color: var(--dsw-alias-state-error-primary);
}
.dqs-ask-recordActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.dqs-ask-clear {
  padding: 4px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dqs-ask-clear:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dqs-ask-clear:disabled {
  border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-caption);
  cursor: default;
}
.dqs-ask-clear[data-confirming="true"] {
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.dqs-ask-clearHint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
@media (prefers-reduced-motion: reduce) {
  .dqs-ask-meterFill {
    transition: none;
  }
}
`;

/**
 * Read the catalog once per mount.
 *
 * The loader itself caches one successful read for a short window, so the two
 * controls of this group share the result instead of listing every provider
 * twice. A failed read stays a note on the row: the "follow the session" choice
 * and the stored value keep working without a catalog.
 */
function useCatalog(loader) {
  const [state, setState] = React.useState({ status: "loading", catalog: null });
  React.useEffect(() => {
    let live = true;
    void loader().then((result) => {
      if (!live) return;
      setState(
        result.ok === true
          ? { status: "ready", catalog: result.catalog }
          : { status: "failed", catalog: null },
      );
    });
    return () => {
      live = false;
    };
  }, [loader]);
  return state;
}

/** Notes that explain a catalog problem without disabling the row. */
function modelNotes({ state, catalog, choice, isKnown, t }) {
  const notes = [];
  if (state.status === "failed") {
    notes.push(
      h("p", { key: "catalogFailed", className: "dqs-ask-note" }, t("settingsModelCatalogFailed")),
    );
  }
  for (const provider of catalog?.failures ?? []) {
    notes.push(
      h(
        "p",
        { key: `provider:${provider}`, className: "dqs-ask-note" },
        t("settingsModelCatalogPartial", { provider }),
      ),
    );
  }
  if (choice !== null && state.status === "ready" && !isKnown) {
    notes.push(
      h("p", { key: "stored", className: "dqs-ask-note" }, t("settingsModelStoredUnavailable")),
    );
  }
  return notes;
}

/**
 * The model menu's rows.
 *
 * `""` is the session choice. The catalog contributes provider headers and the
 * models; a stored model the catalog no longer lists keeps its own row, because
 * the trigger must show what is saved while the next question would fail on the
 * host.
 */
function modelItems(catalog, choice, selectedKey, t) {
  const items = [
    { kind: "option", key: "", label: t("settingsModelFollow") },
    ...modelOptionEntries(catalog),
  ];
  if (choice !== null && !hasModel(catalog, choice)) {
    items.push({ kind: "option", key: selectedKey, label: `${choice.provider} / ${choice.model}` });
  }
  return items;
}

/** The trigger text: the chosen model's display name, or the saved ids. */
function modelLabel(items, choice, selectedKey, t) {
  if (choice === null) return t("settingsModelFollow");
  const item = items.find((entry) => entry.key === selectedKey && entry.kind !== "header");
  return item === undefined ? `${choice.provider} / ${choice.model}` : item.label;
}

/**
 * The model picker.
 *
 * The value is `null` for "follow the session" or `{ provider, model }`. The
 * menu carries one encoded string per row because the picker deals in option
 * keys; the settings field itself keeps the object, so the host does not have to
 * split a composite id.
 */
function ModelControl({ loader, value, set, t }) {
  const state = useCatalog(loader);
  const choice = readChoice(value);
  const selectedKey = choice === null ? "" : modelKey(choice.provider, choice.model);
  const isKnown = hasModel(state.catalog, choice);
  const items = modelItems(state.catalog, choice, selectedKey, t);
  return h(
    React.Fragment,
    null,
    h("style", null, STYLE),
    h(
      "div",
      { className: "dqs-ask-control" },
      h(Picker, {
        ariaLabel: t("settingsModelTitle"),
        menuLabel: t("settingsModelTitle"),
        label: modelLabel(items, choice, selectedKey, t),
        items,
        selectedKey,
        searchPlaceholder: t("settingsModelSearch"),
        searchAriaLabel: t("settingsModelSearch"),
        onSelect: (key) => {
          if (key === "") {
            set(null);
            return;
          }
          const parsed = splitModelKey(key);
          if (parsed !== null) set(parsed);
        },
      }),
      ...modelNotes({ state, catalog: state.catalog, choice, isKnown, t }),
    ),
  );
}

/**
 * The reasoning-effort picker.
 *
 * The stored value is `"lowest"` or one adapter-owned effort id. The offered
 * levels follow the model chosen in the row above, read live from the settings
 * store; "follow the session" has no known model, so it offers the union and the
 * host picks the level nearest below it. A stored level the current model does
 * not offer stays visible with a note, because the host will floor it and the
 * user should know that before asking.
 */
function EffortControl({ loader, value, set, t, readModel }) {
  const state = useCatalog(loader);
  const requested = typeof value === "string" && value !== "" ? value : LOWEST_EFFORT;
  const choice = readChoice(readModel());
  const efforts = state.catalog === null ? [] : effortsForChoice(state.catalog, choice);
  const items = [
    { kind: "option", key: LOWEST_EFFORT, label: t("settingsEffortLowest") },
    ...efforts.map((effort) => ({ kind: "option", key: effort.id, label: effort.name })),
  ];
  if (!items.some((item) => item.key === requested)) {
    items.push({ kind: "option", key: requested, label: requested });
  }
  const label = items.find((item) => item.key === requested)?.label ?? requested;
  const isStranded =
    requested !== LOWEST_EFFORT &&
    state.status === "ready" &&
    !efforts.some((effort) => effort.id === requested);
  return h(
    React.Fragment,
    null,
    h("style", null, STYLE),
    h(
      "div",
      { className: "dqs-ask-control" },
      h(Picker, {
        ariaLabel: t("settingsEffortTitle"),
        menuLabel: t("settingsEffortTitle"),
        label,
        items,
        selectedKey: requested,
        onSelect: (key) => set(key),
      }),
      isStranded
        ? h("p", { key: "stored", className: "dqs-ask-note" }, t("settingsEffortStoredUnavailable"))
        : null,
    ),
  );
}

/**
 * The storage cap, its measured readout, and the clear action.
 *
 * The cap is a free size in megabytes rather than a list of presets: a record's
 * size depends on the answer and the thinking it carries, so any fixed tier
 * would be a guess about someone else's history. The readout is computed from
 * the same serialization the store writes and translated into records, which is
 * the unit a reader can actually judge. With no records yet it falls back to a
 * reference record weighed by that same serializer, so the empty state still
 * gives a number; both paths are worded as an estimate.
 *
 * Clearing asks twice in place instead of opening a dialog: the panel's modal
 * shell owns dialogs, and a second click on the same row is enough to confirm
 * an action whose effect is visible immediately. The hint next to it says what
 * clearing does and does not touch, so the destructive action is readable
 * before it is pressed.
 */
function RecordLimitControl({ store, value, set, t }) {
  const limit = readAskRecordLimit(value);
  const [text, setText] = React.useState(() => limitTextOf(limit));
  const [isInvalid, setIsInvalid] = React.useState(false);
  const [, setRevision] = React.useState(0);
  const [confirming, setConfirming] = React.useState(false);
  // The value this input last wrote. A change equal to it came from this
  // control, so syncing the text back would fight the caret while typing.
  const emitted = React.useRef(limit);
  const timerRef = React.useRef(0);

  React.useEffect(() => {
    if (store === null || typeof store.subscribe !== "function") return undefined;
    return store.subscribe(() => setRevision((current) => current + 1));
  }, [store]);

  React.useEffect(() => {
    if (value === emitted.current) return;
    const next = readAskRecordLimit(value);
    emitted.current = next;
    setText(limitTextOf(next));
    setIsInvalid(false);
  }, [value]);

  React.useEffect(
    () => () => {
      if (timerRef.current !== 0) clearTimeout(timerRef.current);
    },
    [],
  );

  const records = typeof store?.records === "function" ? store.records() : [];
  const stats = weighAskRecords(records);
  const projected = projectAskRecordCount(stats, limit);
  const limited = limit > 0 ? trimAskRecordsToLimit(records, limit) : null;
  const overflow = limited === null ? 0 : stats.count - limited.length;
  const percent = limit > 0 ? Math.min(100, (stats.bytes / limit) * 100) : 0;

  // Three lines at most: what is used, the bar, and what still fits. A fresh
  // profile has no measured average, so its second line falls back to the
  // weighed reference record and says "about"; the number is still derived by
  // the same serializer, not written into the copy.
  const usage =
    stats.count === 0
      ? t("settingsRecordEmpty")
      : t("settingsRecordUsage", {
          count: stats.count,
          size: formatAskRecordSize(stats.bytes),
          limit: formatAskRecordSize(limit),
        });
  const estimate =
    stats.count === 0
      ? t("settingsRecordEstimate", {
          limit: formatAskRecordSize(limit),
          count: projectAskRecordCount(referenceAskRecordWeigh(), limit),
        })
      : projected === null
        ? ""
        : t("settingsRecordProjection", { count: projected });

  function commit(bytes) {
    emitted.current = bytes;
    set(bytes);
  }

  function onInput(event) {
    const next = event.target.value;
    setText(next);
    if (next.trim() === "") {
      setIsInvalid(false);
      commit(askRecordLimitBytesOfMegabytes(0));
      return;
    }
    const megabytes = Number(next);
    if (!Number.isFinite(megabytes) || megabytes < 0 || megabytes > MAX_LIMIT_MB) {
      setIsInvalid(true);
      return;
    }
    setIsInvalid(false);
    commit(askRecordLimitBytesOfMegabytes(megabytes));
  }

  // The input settles on the last value this control wrote, not on the render's
  // prop: a commit and the blur can arrive in one batch, and reading the stale
  // prop here would revert the text while the stored cap is already new.
  function onBlur() {
    setText(limitTextOf(emitted.current));
    setIsInvalid(false);
  }

  function disarm() {
    if (timerRef.current !== 0) {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
    setConfirming(false);
  }

  function onClear() {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = 0;
        setConfirming(false);
      }, CLEAR_CONFIRM_MS);
      return;
    }
    disarm();
    if (typeof store?.clearRecords === "function") store.clearRecords();
  }

  return h(
    React.Fragment,
    null,
    h("style", null, STYLE),
    h(
      "div",
      { className: "dqs-ask-control dqs-ask-record" },
      h(
        "div",
        { className: "dqs-ask-recordRow" },
        h("span", { className: "dqs-ask-recordLabel" }, t("settingsRecordLimitLabel")),
        h("input", {
          type: "number",
          className: "dqs-ask-number",
          "aria-label": t("settingsRecordLimitTitle"),
          min: 0,
          max: MAX_LIMIT_MB,
          step: "any",
          inputMode: "decimal",
          value: text,
          onChange: onInput,
          onBlur,
          "aria-invalid": isInvalid ? "true" : undefined,
        }),
        h("span", { className: "dqs-ask-unit" }, t("settingsRecordUnit")),
      ),
      isInvalid
        ? h(
            "p",
            { className: "dqs-ask-note dqs-ask-invalid" },
            t("settingsRecordInvalid", { max: MAX_LIMIT_MB }),
          )
        : null,
      h("div", { className: "dqs-ask-usage" }, usage),
      stats.count > 0 && limit > 0
        ? h(
            "div",
            {
              className: "dqs-ask-meter",
              role: "progressbar",
              "aria-label": t("settingsRecordUsageLabel"),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(percent),
            },
            h("div", {
              className: "dqs-ask-meterFill",
              "data-over": stats.bytes > limit ? "true" : "false",
              style: {
                width: `${percent}%`,
                // A single record is a fraction of a percent, and a fill that
                // collapses to nothing reads as a stray divider instead of a
                // meter; two pixels keep the bar a bar at any usage.
                minWidth: stats.bytes > 0 ? "2px" : "0",
              },
            }),
          )
        : null,
      estimate === "" ? null : h("div", { className: "dqs-ask-estimate" }, estimate),
      stats.count === 0
        ? h("div", { className: "dqs-ask-estimate" }, t("settingsRecordNoData"))
        : null,
      overflow > 0
        ? h("div", { className: "dqs-ask-over" }, t("settingsRecordOver", { count: overflow }))
        : null,
      h(
        "div",
        { className: "dqs-ask-recordActions" },
        h(
          "button",
          {
            type: "button",
            className: "dqs-ask-clear",
            "data-confirming": confirming ? "true" : "false",
            disabled: stats.count === 0,
            title: t("settingsRecordClearHint"),
            onClick: onClear,
          },
          confirming ? t("settingsRecordClearConfirm") : t("settingsRecordClear"),
        ),
        h("span", { className: "dqs-ask-clearHint" }, t("settingsRecordClearHint")),
      ),
    ),
  );
}

/**
 * Declare the settings fields for the ask module.
 *
 * Field ids become the storage path (`ask.model`, `ask.reasoningEffort`,
 * `ask.recordLimit`), and `custom` is the only type whose values are dynamic:
 * the model list comes from the Host at render time, the effort list depends on
 * the chosen model, and the storage readout depends on the live record list.
 * The controls close over `api` and `store` here because `render` is handed
 * only `{ field, value, set, t }`.
 */
export function createAskSettings(api, store) {
  const loader = createCatalogLoader({ api });
  const readModel = () => api.settings.get("model");
  return {
    modelField: {
      id: "model",
      type: "custom",
      default: null,
      labelKey: "settingsModelTitle",
      descriptionKey: "settingsModelDescription",
      hintKey: "settingsModelHint",
      render: (props) => h(ModelControl, { ...props, loader }),
    },
    effortField: {
      id: "reasoningEffort",
      type: "custom",
      default: LOWEST_EFFORT,
      labelKey: "settingsEffortTitle",
      descriptionKey: "settingsEffortDescription",
      hintKey: "settingsEffortHint",
      render: (props) => h(EffortControl, { ...props, loader, readModel }),
    },
    recordLimitField: {
      id: "recordLimit",
      type: "custom",
      // The input, the meter, the readout and the clear action need the whole
      // row; the side-by-side default would squeeze them into 220px.
      layout: "stack",
      default: ASK_RECORD_LIMIT_DEFAULT_BYTES,
      labelKey: "settingsRecordLimitTitle",
      descriptionKey: "settingsRecordLimitDescription",
      hintKey: "settingsRecordLimitHint",
      render: (props) => h(RecordLimitControl, { ...props, store }),
    },
  };
}
