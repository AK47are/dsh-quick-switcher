/* Settings controls for the side-question model and its reasoning effort. */

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

const h = React.createElement;

/**
 * Styles for the two custom controls.
 *
 * They live in the module because the core settings page only styles its own
 * generic controls; a custom renderer owns its look the same way the ask detail
 * owns its answer typography. The trigger and menu themselves are styled by the
 * picker, so this block only holds the column and the inline notes.
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
.dqs-ask-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
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
 * Declare the two settings fields for the ask module.
 *
 * Field ids become the storage path (`ask.model`, `ask.reasoningEffort`), and
 * `custom` is the only type whose values are dynamic: the model list comes from
 * the Host at render time and the effort list depends on the chosen model. The
 * controls close over `api` here because `render` is handed only
 * `{ field, value, set, t }`.
 */
export function createAskSettings(api) {
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
  };
}
