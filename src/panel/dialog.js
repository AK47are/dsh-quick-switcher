/* Panel shell: input, selection, keyboard, and route dispatch. */

import React from "react";
import { canCopy, canFork, canRegenerate } from "../ask-store.js";
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
import { AskDetail, AskFooter } from "./ask-detail.js";
import { digitRowIndex } from "./digit-jump.js";
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
 * Whether focus sits in a control that consumes plain letters.
 *
 * A locked side-question input matches too: it is read-only, but the user can
 * still select and copy the question there, so C, R, F, and S must stay
 * letters rather than shortcuts while it has focus.
 */
function isEditableTarget(target) {
  if (target === null || typeof target !== "object") return false;
  if (target.isContentEditable === true) return true;
  if (typeof target.closest !== "function") return false;
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
    ) !== null
  );
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
  history,
  ask,
  seed,
  captureDraft,
  generation,
  uiWorkspace,
  shortcuts,
  files,
  layout,
  panels,
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
  // The id, not just a flag: the panels route marks the page the main area is
  // showing, while the session list keeps hiding the retained session behind it.
  const activePanelId = usePanelInfo((info) => info.activePanelId);
  const isPanelActive = activePanelId !== null;

  // An asynchronous route (the "@" file search) asks the shell for one more
  // render after its result settles; `revision` is the shell's answer and the
  // only reason a view may be rebuilt without a query or data change.
  const [revision, bump] = React.useReducer((value) => value + 1, 0);

  // Route instances live for one panel mount, so the workspaces token resets
  // when the panel closes instead of leaking into the next open.
  const routes = React.useRef(null);
  if (routes.current === null) {
    routes.current = createRoutes({ notify: bump, store: ask });
  }
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
  // The pending card a side question would be about. It is read from the same
  // unified status the sidebar uses, so the background sent with a question is
  // exactly the card the user can see waiting.
  const pending =
    currentId === null ? null : statuses?.get?.(currentId)?.pendingInteraction ?? null;
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

  // The panel registry is owned outside React and changes when a plugin with a
  // main panel loads or unloads, or when the language switch re-evaluates the
  // labels.
  const panelEntries = React.useSyncExternalStore(
    panels.subscribe,
    panels.getSnapshot,
  );

  // The bridge publishes the current session's prompt window, draft, and
  // pagination flags. The dialog subscribes so `loadOlder` results and a
  // completed write land without reopening the panel.
  const historySnapshot = React.useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
    history.getSnapshot,
  );
  // The draft row stands for the text the composer held when the panel
  // opened, not for what it holds after a history entry replaced it. Freezing
  // it here is what makes that row a restore target. The slash command turns
  // the capture off because its own token is still the last published draft
  // at mount, while the input has already removed it.
  const draftAtOpen = React.useMemo(
    () => (captureDraft ? history.getSnapshot().draft : ""),
    [captureDraft],
  );
  const historyView = React.useMemo(
    () => ({ ...historySnapshot, draft: draftAtOpen }),
    [historySnapshot, draftAtOpen],
  );

  const [query, setQuery] = React.useState(seed);
  // The caret starts on the first row: the previous session when the access
  // history knows one, otherwise the status leader. Opening the panel never
  // jumps to the current session, because the first Enter should switch away
  // from it rather than close the panel.
  const [selected, setSelected] = React.useState(0);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [caretRequest, setCaretRequest] = React.useState(0);
  // Copy feedback and the fork request are the only side-question state the
  // shell owns; everything that survives a render lives in the record store.
  const [askUi, setAskUi] = React.useState({
    copied: false,
    copyFailed: false,
    forking: false,
  });

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
        pending,
        commandEntries,
        commandsLoading,
        files,
        panelEntries,
        activePanelId,
        history: historyView,
        t,
        now: Date.now(),
      }),
    [
      query,
      entries,
      workspaceRows,
      currentId,
      pending,
      commandEntries,
      commandsLoading,
      files,
      panelEntries,
      activePanelId,
      historyView,
      t,
      revision,
    ],
  );
  const rows = view.rows;
  // A route that renders a component instead of rows owns the list area. The
  // record is read here rather than carried in the view, so the answer on
  // screen is the one the store holds at this render, not one captured when
  // the descriptor was built.
  const contentShown = view.content !== null && view.content !== undefined;
  const askRecord =
    view.content?.kind === "ask" && ask !== undefined
      ? ask.find(view.content.id)
      : null;

  // Commands ask the store which mode the panel shows, and the edited query is
  // the only truth for that. Republishing the claiming prefix keeps the
  // history shortcut's toggle decision in step with what the user actually
  // deleted or typed.
  React.useEffect(() => {
    store.setPrefix(view.prefix ?? "");
  }, [store, view.prefix]);

  // A route that cannot answer synchronously returns empty rows plus a `load`
  // to run after the render. The route dedupes by query, so re-renders caused
  // by unrelated data (statuses, the shortcut catalog) cost nothing.
  React.useEffect(() => {
    view.load?.();
  }, [view]);

  const inputRef = React.useRef(null);
  const closeRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const copyTimer = React.useRef(0);
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
      // An empty seed is a blank search box, so selecting it all costs
      // nothing. A seeded query is a prefix the user continues from, and
      // selecting it would let the first typed character replace the mode.
      if (seed === "") input.select?.();
      else input.setSelectionRange?.(input.value.length, input.value.length);
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

  // Leaving the detail puts the caret back in the input, which is again the
  // only control that can change the query. Entering the detail focuses the
  // answer itself, so this direction is deliberately one-way.
  const hadContent = React.useRef(false);
  React.useEffect(() => {
    if (hadContent.current && !contentShown) inputRef.current?.focus();
    hadContent.current = contentShown;
  }, [contentShown]);

  // A command fired while the panel is open reseeds the query in place, so
  // switching to history does not close and remount the surface the user is
  // already reading. The caret lands after the seeded prefix.
  const lastGeneration = React.useRef(generation);
  React.useEffect(() => {
    if (lastGeneration.current === generation) return;
    lastGeneration.current = generation;
    setQuery(seed);
    setError(null);
    setNotice(null);
    setSelected(0);
    setCaretRequest((value) => value + 1);
  }, [generation, seed]);

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

  // A main panel belongs to the layout rather than to a workspace: selecting
  // one swaps the conversation for that panel. The call throws when the panel
  // unregistered between the list being built and the key press, so the
  // failure is reported in place instead of closing onto a dead row.
  const openPanel = (panelId) => {
    setError(null);
    try {
      layout.selectPanel(panelId);
      return true;
    } catch {
      setError(t("panelOpenFailed"));
      return false;
    }
  };

  const activation = { openSession, startSession, openPanel };

  /**
   * Copy the answer and report the outcome next to the button.
   *
   * The clipboard API is missing or blocked in some embeds; that is a normal
   * refusal, so it becomes a visible label instead of an exception.
   */
  const copyAnswer = async () => {
    const text = askRecord?.answer ?? "";
    if (text === "") return;
    try {
      await navigator.clipboard.writeText(text);
      if (copyTimer.current !== 0) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = 0;
        setAskUi((value) => ({ ...value, copied: false }));
      }, 1600);
      setAskUi((value) => ({ ...value, copied: true, copyFailed: false }));
    } catch (failure) {
      console.error("[dsh-quick-switcher] clipboard write failed", failure);
      setAskUi((value) => ({ ...value, copied: false, copyFailed: true }));
    }
  };

  const stopAnswer = () => {
    if (askRecord === null || ask === undefined) return;
    ask.stop(askRecord.sessionId, askRecord.id);
  };

  const regenerateAnswer = () => {
    if (askRecord === null || ask === undefined) return;
    ask.regenerate(askRecord.sessionId, askRecord.id);
  };

  /**
   * Fork the exchange and follow it into the child session.
   *
   * Focus is deliberately not restored: the panel closes because the main area
   * now shows a different conversation, and handing the caret back to the
   * pre-panel control would undo that navigation. A failed navigation keeps the
   * panel open so the error stays readable and the same fork can be retried.
   */
  const forkAnswer = async () => {
    if (askRecord === null || ask === undefined || askUi.forking) return;
    setAskUi((value) => ({ ...value, forking: true }));
    setError(null);
    try {
      const childId = await ask.fork(askRecord.sessionId, askRecord.id);
      if (childId === null) return;
      if (!openSession(childId)) return;
      close(false);
    } catch (failure) {
      console.error("[dsh-quick-switcher] side question fork failed", failure);
      setError(t("askForkFailed"));
    } finally {
      setAskUi((value) => ({ ...value, forking: false }));
    }
  };

  // A new answer makes an earlier "已复制" a lie; the record id and its status
  // are the two events that begin or end one.
  React.useEffect(() => {
    setAskUi((value) =>
      value.copied || value.copyFailed
        ? { ...value, copied: false, copyFailed: false }
        : value,
    );
  }, [askRecord?.id, askRecord?.status]);

  React.useEffect(
    () => () => {
      if (copyTimer.current !== 0) window.clearTimeout(copyTimer.current);
    },
    [],
  );
  const buildView = (nextQuery) =>
    pickView(routes.current, nextQuery, {
      sessionEntries: entries,
      workspaceRows,
      currentId,
      pending,
      commandEntries,
      commandsLoading,
      files,
      panelEntries,
      activePanelId,
      history: historyView,
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

  /**
   * Write one history row into the conversation input without closing the
   * panel: history is a pick surface, and the draft row only makes sense while
   * the panel stays open to go back to it. The bridge store refuses while the
   * input is frozen, so a refusal becomes a visible error instead of a silent
   * no-op.
   */
  const applyHistory = (text) => {
    if (history.apply(text)) {
      setError(null);
      setNotice(t("historyApplied"));
      return;
    }
    setNotice(null);
    setError(t("historyApplyFailed"));
  };

  const loadOlderHistory = () => {
    setError(null);
    const loading = history.loadOlder();
    if (loading && typeof loading.catch === "function") {
      loading.catch(() => setError(t("historyLoadFailed")));
    }
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
    if (effect.type === "history") {
      applyHistory(effect.text);
      return;
    }
    if (effect.type === "history-older") {
      loadOlderHistory();
      return;
    }
    if (effect.type === "query") {
      const nextView = buildView(effect.query);
      setQuery(effect.query);
      const index = effect.selectedKey
        ? nextView.rows.findIndex((row) => row.key === effect.selectedKey)
        : -1;
      setSelected(index >= 0 ? index : firstContentIndex(nextView.rows));
      // A detail view focuses its own answer; pulling the caret back to the
      // input would scroll the answer away and stop the arrow keys from
      // scrolling it.
      if (nextView.content === null || nextView.content === undefined) {
        setCaretRequest((value) => value + 1);
      }
    }
  };

  /**
   * Apply a row's primary action.
   *
   * The two actions are separate handlers instead of one function taking a
   * shift flag, so each call site names the action it means, and the alternate
   * one still falls back to the primary one on rows that have no shiftRun.
   */
  const activateRow = (row) => {
    if (!row.run) return;
    applyEffect(row.run(activation));
  };

  const activateShiftRow = (row) => {
    const runner = row.shiftRun ?? row.run;
    if (!runner) return;
    applyEffect(runner(activation));
  };

  const onQueryChange = (value) => {
    const nextView = buildView(value);
    setQuery(value);
    setError(null);
    setNotice(null);
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
      // The detail view adds its own focusables (the answer area and the
      // action buttons), so the cycle is read from the card instead of being
      // fixed to the input and the close button.
      const card = cardRef.current;
      const focusables =
        card === null
          ? [inputRef.current, closeRef.current].filter(Boolean)
          : [...card.querySelectorAll('input, button, [tabindex="0"]')].filter(
              (node) => node.disabled !== true && node.getClientRects().length > 0,
            );
      if (focusables.length === 0) return;
      const index = focusables.indexOf(document.activeElement);
      const step = event.shiftKey ? -1 : 1;
      const next = focusables[(index + step + focusables.length) % focusables.length];
      next?.focus();
      return;
    }
    if (contentShown) {
      // Backspace is the detail's back key. A text selection keeps its native
      // meaning, so selecting part of the question to copy does not navigate
      // away when the user then presses it.
      if (key === "Backspace") {
        const input = inputRef.current;
        const hasSelection =
          input !== null &&
          document.activeElement === input &&
          typeof input.selectionStart === "number" &&
          input.selectionStart !== input.selectionEnd;
        if (!hasSelection && typeof view.back === "function") {
          event.preventDefault();
          view.back();
        }
        return;
      }
      // Letters stay letters in an input, even the locked one.
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const letter = key.toLowerCase();
      if (letter === "s" && askRecord?.status === "running") {
        event.preventDefault();
        stopAnswer();
        return;
      }
      if (letter === "c" && askRecord !== null && canCopy(askRecord)) {
        event.preventDefault();
        void copyAnswer();
        return;
      }
      if (letter === "r" && askRecord !== null && canRegenerate(askRecord)) {
        event.preventDefault();
        regenerateAnswer();
        return;
      }
      if (
        letter === "f" &&
        askRecord !== null &&
        canFork(askRecord) &&
        !askUi.forking
      ) {
        event.preventDefault();
        void forkAnswer();
      }
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
    const digitIndex = digitRowIndex(event.nativeEvent ?? event);
    if (digitIndex !== null) {
      // Swallow the key even when no such row exists: on macOS Alt+digit types
      // a symbol, and an out-of-range press must not edit the query.
      event.preventDefault();
      event.stopPropagation();
      const row = rows[digitIndex];
      if (!row) return;
      // Moving the caret first leaves it on the row that just ran, which is
      // what the modes that stay open (history and side questions) show.
      setSelected(digitIndex);
      // Shift is ignored on purpose: layouts that need Shift for a plain digit
      // would otherwise fire the alternate action instead of the primary one.
      activateRow(row);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (!row) return;
      if (event.shiftKey) activateShiftRow(row);
      else activateRow(row);
    }
  };

  const hints = [{ keys: ["↑", "↓"], label: t("hintSelect") }, ...(view.hints ?? [])];
  const activeId = rows.length === 0 ? undefined : `dqs-option-${selected}`;
  const locked = view.inputLocked === true;

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
          onActivate: (shiftKey) =>
            shiftKey ? activateShiftRow(row) : activateRow(row),
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
        ref: cardRef,
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
          // A locked input is a plain text field: it controls no list, and
          // claiming to be a combobox would promise arrow-key options that are
          // not there while the detail is open.
          role: locked ? "textbox" : "combobox",
          "aria-expanded": locked ? undefined : "true",
          "aria-controls": locked ? undefined : listId,
          "aria-activedescendant": locked ? undefined : activeId,
          "aria-autocomplete": locked ? undefined : "list",
          readOnly: locked,
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
      contentShown
        ? h(
            "div",
            { className: "dqs-content" },
            askRecord === null
              ? null
              : h(AskDetail, { key: askRecord.id, record: askRecord, t }),
          )
        : h(
            "div",
            {
              className: "dqs-list",
              id: listId,
              role: "listbox",
              "aria-label": view.listLabel,
            },
            children,
          ),
      notice === null ? null : h("div", { className: "dqs-notice", role: "status" }, notice),
      error === null ? null : h("div", { className: "dqs-error", role: "alert" }, error),
      h(
        "div",
        { className: "dqs-footer" },
        contentShown && askRecord !== null
          ? h(AskFooter, {
              record: askRecord,
              t,
              ui: askUi,
              actions: {
                copy: copyAnswer,
                regenerate: regenerateAnswer,
                fork: forkAnswer,
                stop: stopAnswer,
                back: view.back,
              },
            })
          : [
              h(Hints, { key: "hints", hints }),
              h("div", { key: "count", className: "dqs-count" }, view.count),
            ],
      ),
    ),
  );
}
