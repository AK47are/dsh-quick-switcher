/* Panel shell: input, selection, keyboard, and route dispatch. */

import React from "react";
import { getAccessStore } from "../data/access.js";
import {
  buildCommandEntries,
  commandContext,
  resolveCommand,
} from "../data/commands.js";
import { collectSessionEntries } from "../data/sessions.js";
import { collectWorkspaceRows } from "../data/workspaces.js";
import { createPointerGate, getPointerBaseline } from "../pointer.js";
import { createRoutes, pickView } from "../routes/index.js";
import { CloseGlyph, RowView, SearchGlyph } from "./rows.js";
import { focusSidebarPane } from "./rightbar.js";
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
  shortcuts,
  files,
  recent,
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

  // An asynchronous route (the "@" file search) asks the shell for one more
  // render after its result settles; `revision` is the shell's answer and the
  // only reason a view may be rebuilt without a query or data change.
  const [revision, bump] = React.useReducer((value) => value + 1, 0);

  // Route instances live for one panel mount, so the workspaces token resets
  // when the panel closes instead of leaking into the next open.
  const routes = React.useRef(null);
  if (routes.current === null) routes.current = createRoutes({ notify: bump });
  React.useEffect(
    () => () => {
      for (const route of routes.current ?? []) route.dispose?.();
    },
    [],
  );

  // The access map is read once per panel mount: the modal blocks navigation,
  // so no visit can be recorded while it is open.
  const accessTimes = React.useMemo(() => getAccessStore().getSnapshot(), []);
  const sessionData = React.useMemo(
    () =>
      collectSessionEntries(
        sessionList,
        workspaceList,
        statuses,
        isPanelActive,
        accessTimes,
      ),
    [sessionList, workspaceList, statuses, isPanelActive, accessTimes],
  );
  const { entries, currentId } = sessionData;
  const workspaceRows = React.useMemo(
    () => collectWorkspaceRows(workspaceList, entries),
    [workspaceList, entries],
  );

  // The shortcut catalog is a snapshot store owned by DSH. Reading it here
  // keeps the command list live while plugins register or unload commands, and
  // the localized labels refresh with the catalog itself. Recents are read per
  // catalog change; opening the panel is the only moment the order is needed.
  const commandCatalog = React.useSyncExternalStore(
    shortcuts.catalog.subscribe,
    shortcuts.catalog.getSnapshot,
  );
  const shortcutConfig = React.useSyncExternalStore(
    shortcuts.config.subscribe,
    shortcuts.config.getSnapshot,
  );
  const commandEntries = React.useMemo(
    () => buildCommandEntries(commandCatalog, recent.read()),
    [commandCatalog, recent],
  );
  const commandsLoading = shortcutConfig.status === "loading";

  const [query, setQuery] = React.useState("");
  // The caret starts on the first row: the previous session when the access
  // history knows one, otherwise the status leader. Opening the panel never
  // jumps to the current session, because the first Enter should switch away
  // from it rather than close the panel.
  const [selected, setSelected] = React.useState(0);
  const [error, setError] = React.useState(null);
  const [caretRequest, setCaretRequest] = React.useState(0);

  // Hover only moves the caret once the pointer really moved. Browsers replay
  // hover events for elements that appear under a stationary pointer, so an
  // unguarded hover would replace the opening row and could also steal the
  // caret when a query reflow puts another row under the same pointer. The
  // gate is seeded with the position recorded before the panel opened.
  const hoverGate = React.useRef(null);
  if (hoverGate.current === null) {
    hoverGate.current = createPointerGate(getPointerBaseline());
  }

  const view = React.useMemo(
    () =>
      pickView(routes.current, query, {
        sessionEntries: entries,
        workspaceRows,
        currentId,
        commandEntries,
        commandsLoading,
        files,
        t,
        now: Date.now(),
      }),
    [
      query,
      entries,
      workspaceRows,
      currentId,
      commandEntries,
      commandsLoading,
      files,
      t,
      revision,
    ],
  );
  const rows = view.rows;

  // A route that cannot answer synchronously returns empty rows plus a `load`
  // to run after the render. The route dedupes by query, so re-renders caused
  // by unrelated data (statuses, the shortcut catalog) cost nothing.
  React.useEffect(() => {
    view.load?.();
  }, [view]);

  const inputRef = React.useRef(null);
  const closeRef = React.useRef(null);
  const previousFocus = React.useRef(null);
  const skipRestore = React.useRef(false);
  const rowRefs = React.useRef(new Map());
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

  /**
   * Ask DSH to show one workspace file in the right Sidebar.
   *
   * The address carries the Session, so the Sidebar needs no absolute path
   * from the panel. A throw means there is no on-screen Session surface to
   * place the tab in; the panel stays open and reports it instead of closing
   * over a file the user never sees.
   */
  const openFile = (path) => {
    if (currentId === null) return false;
    try {
      files.open(currentId, path);
      return true;
    } catch (error) {
      console.error("[dsh-quick-switcher] file open failed", error);
      setError(t("fileOpenFailed"));
      return false;
    }
  };

  const buildView = (nextQuery) =>
    pickView(routes.current, nextQuery, {
      sessionEntries: entries,
      workspaceRows,
      currentId,
      commandEntries,
      commandsLoading,
      files,
      t,
      now: Date.now(),
    });

  /**
   * Close the overlay, then run a command on the next task.
   *
   * `resolve` already ran while the overlay was open, so a blocked command
   * never reaches this path. Deferring the action lets React unmount the
   * dialog and restore the pre-open focus first; a command that opens its own
   * modal would otherwise stack on top of a still-mounted overlay. A throwing
   * command after the panel is gone has no surface left to report through, so
   * it is logged instead of swallowed.
   */
  const runCommand = (id) => {
    const outcome = resolveCommand(
      shortcuts.registry,
      id,
      commandContext(previousFocus.current),
    );
    if (outcome.status === "missing") {
      setError(t("commandMissing"));
      return;
    }
    if (outcome.status === "failed") {
      console.error("[dsh-quick-switcher] command resolve failed", outcome.error);
      setError(t("commandFailed"));
      return;
    }
    if (outcome.status !== "handled") {
      setError(outcome.reason ?? t("commandBlocked"));
      return;
    }

    recent.record(id);
    close(true);
    window.setTimeout(() => {
      try {
        outcome.run();
      } catch (error) {
        console.error("[dsh-quick-switcher] command failed", error);
      }
    }, 0);
  };

  const applyEffect = (effect) => {
    if (!effect) return;
    if (effect.type === "close") {
      close(effect.restoreFocus === true);
      return;
    }
    if (effect.type === "file") {
      if (!openFile(effect.path)) return;
      if (effect.focus === "preview") {
        // Skipping focus restoration keeps the panel from yanking the caret
        // back to the composer while the Sidebar column is opening.
        close(false);
        focusSidebarPane(document, currentId);
      } else {
        close(true);
      }
      return;
    }
    if (effect.type === "command") {
      runCommand(effect.id);
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
    setError(null);
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
          onPointerMove: (event) => {
            if (!hoverGate.current.accept(event.clientX, event.clientY)) return;
            setSelected(index);
          },
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
