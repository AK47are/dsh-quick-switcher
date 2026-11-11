/* Panel shell: input, selection, keyboard, and route dispatch. */

import React from "react";
import { collectSessionEntries } from "../data/sessions.js";
import { collectWorkspaceRows } from "../data/workspaces.js";
import { createRoutes, pickView } from "../routes/index.js";
import { CloseGlyph, RowView, SearchGlyph } from "./rows.js";
import { Hints } from "./hints.js";
import { STYLE } from "./styles.js";

const h = React.createElement;

/** First row the caret may land on; action rows such as 新建会话 are skipped. */
function firstContentIndex(rows) {
  const index = rows.findIndex((row) => row.action !== true);
  return index < 0 ? 0 : index;
}

/**
 * The panel itself.
 *
 * Root slot components receive DSH's standard session hooks. Reading
 * `useSessionStatus` here is intentional: the sidebar consumes the same
 * unified status source, so pending interactions, completion reminders, and
 * live running events reach both surfaces without a second cache.
 *
 * `usePanelInfo` is the same panel-selection source the sidebar reads, so the
 * current badge follows the conversation actually shown in the main view
 * instead of the session that merely remains retained.
 *
 * The list itself comes from the active route: the shell only renders uniform
 * rows, moves the selection, and applies the effect a row returns. Adding a
 * search mode means adding a route, not editing this component.
 */
export function QuickSwitcherDialog({
  store,
  uiWorkspace,
  t,
  useSessions,
  useWorkspaces,
  useSessionStatus,
  usePanelInfo,
}) {
  const sessionList = useSessions((state) => state);
  const workspaceList = useWorkspaces((state) => state);
  const statuses = useSessionStatus((state) => state);
  const isPanelActive = usePanelInfo((info) => info.activePanelId !== null);

  // Route instances live for one panel mount, so the workspaces token resets
  // when the panel closes instead of leaking into the next open.
  const routes = React.useRef(null);
  if (routes.current === null) routes.current = createRoutes();

  const sessionData = React.useMemo(
    () => collectSessionEntries(sessionList, workspaceList, statuses, isPanelActive),
    [sessionList, workspaceList, statuses, isPanelActive],
  );
  const { entries, currentId } = sessionData;
  const workspaceRows = React.useMemo(
    () => collectWorkspaceRows(workspaceList, entries),
    [workspaceList, entries],
  );

  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  const [error, setError] = React.useState(null);
  const [caretRequest, setCaretRequest] = React.useState(0);

  const view = React.useMemo(
    () =>
      pickView(routes.current, query, {
        sessionEntries: entries,
        workspaceRows,
        currentId,
        t,
        now: Date.now(),
      }),
    [query, entries, workspaceRows, currentId, t],
  );
  const rows = view.rows;

  const inputRef = React.useRef(null);
  const closeRef = React.useRef(null);
  const previousFocus = React.useRef(null);
  const skipRestore = React.useRef(false);
  const rowRefs = React.useRef(new Map());
  const initialSelection = React.useRef(false);
  const titleId = React.useId();
  const listId = React.useId();

  React.useEffect(() => {
    previousFocus.current = document.activeElement;
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select?.();
    }
    return () => {
      if (skipRestore.current) return;
      const previous = previousFocus.current;
      if (previous && previous.isConnected && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, []);

  // The caret follows a token a row just inserted. React updates the value
  // from state, but only an explicit range keeps the caret at the end while
  // the list re-renders around that edit.
  React.useEffect(() => {
    if (caretRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
  }, [caretRequest]);

  // Opening the panel selects the current session when the list starts
  // unfiltered. A route that opens a scope selects its own row instead.
  React.useEffect(() => {
    if (initialSelection.current || rows.length === 0) return;
    initialSelection.current = true;
    if (query !== "") return;
    const index = rows.findIndex((row) => row.current === true);
    if (index > 0) setSelected(index);
  }, [rows, query]);

  React.useEffect(() => {
    if (selected >= rows.length) {
      setSelected(Math.max(0, rows.length - 1));
    }
  }, [rows.length, selected]);

  React.useEffect(() => {
    const row = rows[selected];
    if (!row) return;
    const node = rowRefs.current.get(row.key);
    node?.scrollIntoView({ block: "nearest" });
  }, [rows, selected]);

  React.useEffect(() => {
    const onDocumentKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      store.close();
    };
    document.addEventListener("keydown", onDocumentKeyDown, false);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, false);
  }, [store]);

  const close = (restoreFocus) => {
    skipRestore.current = !restoreFocus;
    store.close();
  };

  const openSession = (sessionId) => {
    setError(null);
    try {
      const result = uiWorkspace.openSession(sessionId);
      if (result && typeof result.catch === "function") {
        result.catch(() => setError(t("openFailed")));
      }
      return true;
    } catch {
      setError(t("openFailed"));
      return false;
    }
  };

  // New sessions go through DSH's own startSession so blank reuse, preset
  // defaults, and navigation stay identical to the sidebar's own button.
  const startSession = (workspaceId) => {
    setError(null);
    try {
      const result = uiWorkspace.startSession(workspaceId);
      if (result && typeof result.catch === "function") {
        result.catch(() => setError(t("createFailed")));
      }
      return true;
    } catch {
      setError(t("createFailed"));
      return false;
    }
  };

  const activation = { openSession, startSession };
  const buildView = (nextQuery) =>
    pickView(routes.current, nextQuery, {
      sessionEntries: entries,
      workspaceRows,
      currentId,
      t,
      now: Date.now(),
    });

  const applyEffect = (effect) => {
    if (!effect) return;
    if (effect.type === "close") {
      close(effect.restoreFocus === true);
      return;
    }
    if (effect.type === "query") {
      const nextView = buildView(effect.query);
      setQuery(effect.query);
      const index = effect.selectedKey
        ? nextView.rows.findIndex((row) => row.key === effect.selectedKey)
        : -1;
      setSelected(index >= 0 ? index : firstContentIndex(nextView.rows));
      setCaretRequest((value) => value + 1);
    }
  };

  const activate = (row, shiftKey) => {
    const runner = shiftKey && row.shiftRun ? row.shiftRun : row.run;
    if (!runner) return;
    applyEffect(runner(activation));
  };

  const onQueryChange = (value) => {
    const nextView = buildView(value);
    setQuery(value);
    // Typing never targets an action row: filter text is about content.
    setSelected(firstContentIndex(nextView.rows));
  };

  const onKeyDown = (event) => {
    if (event.nativeEvent?.isComposing || event.isComposing) return;
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      const focusables = [inputRef.current, closeRef.current].filter(Boolean);
      if (focusables.length === 0) return;
      const index = focusables.indexOf(document.activeElement);
      const step = event.shiftKey ? -1 : 1;
      const next = focusables[(index + step + focusables.length) % focusables.length];
      next?.focus();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = key === "ArrowDown" ? 1 : -1;
      setSelected((value) => (value + step + rows.length) % rows.length);
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      if (rows.length === 0) return;
      setSelected(key === "Home" ? 0 : rows.length - 1);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (!row) return;
      activate(row, event.shiftKey);
    }
  };

  const hints = [{ keys: ["↑", "↓"], label: t("hintSelect") }, ...(view.hints ?? [])];
  const activeId = rows.length === 0 ? undefined : `dqs-option-${selected}`;

  const children = [];
  if (rows.length === 0) {
    if (view.emptyText) {
      children.push(h("div", { className: "dqs-empty", key: "empty" }, view.emptyText));
    }
  } else {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      children.push(
        h(RowView, {
          key: row.key,
          row,
          selected: index === selected,
          index,
          onHover: () => setSelected(index),
          onActivate: (shiftKey) => activate(row, shiftKey),
          registerRef: (node) => {
            if (node) rowRefs.current.set(row.key, node);
            else rowRefs.current.delete(row.key);
          },
        }),
      );
    }
    if (view.note) {
      children.push(h("div", { className: "dqs-empty", key: "note" }, view.note));
    }
  }

  return h(
    "div",
    {
      className: "dqs-overlay",
      role: "presentation",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          close(true);
        }
      },
    },
    h(
      "div",
      {
        className: "dqs-card",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "data-shortcut-modal": "other",
        onKeyDown,
      },
      h("style", null, STYLE),
      h("div", { className: "dqs-sr-only", id: titleId }, t("title")),
      h(
        "div",
        { className: "dqs-search" },
        h(SearchGlyph),
        h("input", {
          ref: inputRef,
          className: "dqs-input",
          value: query,
          onChange: (event) => onQueryChange(event.target.value),
          placeholder: view.placeholder,
          "aria-label": view.searchAria,
          role: "combobox",
          "aria-expanded": "true",
          "aria-controls": listId,
          "aria-activedescendant": activeId,
          "aria-autocomplete": "list",
          autoComplete: "off",
          spellCheck: false,
        }),
        h(
          "button",
          {
            ref: closeRef,
            type: "button",
            className: "dqs-close",
            "aria-label": t("close"),
            onClick: () => close(true),
          },
          h(CloseGlyph),
        ),
      ),
      h(
        "div",
        {
          className: "dqs-list",
          id: listId,
          role: "listbox",
          "aria-label": view.listLabel,
        },
        children,
      ),
      error === null ? null : h("div", { className: "dqs-error", role: "alert" }, error),
      h(
        "div",
        { className: "dqs-footer" },
        h(Hints, { hints }),
        h("div", { className: "dqs-count" }, view.count),
      ),
    ),
  );
}
