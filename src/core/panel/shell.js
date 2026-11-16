/* Panel shell: input, selection, keyboard, and the mounted module surfaces. */

import React from "react";
import { createPointerGate, getPointerBaseline } from "./pointer.js";
import { digitRowIndex } from "./digit-jump.js";
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
 * The shell owns what every mode shares: the input, selection, hover gating,
 * keyboard, focus restore, and the frame around the list. It never computes a
 * domain projection; the mounted modules resolve the view from the query and
 * the shell only renders what came back. A view that carries `content` replaces
 * the list, and its module owns the letter keys through `keydown`.
 */
export function SwitcherShell({
  registry,
  controller,
  t,
  services,
  get,
  currentSessionId,
  activePanelId,
  pending,
  seed,
  generation,
}) {
  const [query, setQuery] = React.useState(seed);
  const [selected, setSelected] = React.useState(0);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [caretRequest, setCaretRequest] = React.useState(0);
  // A module's store can settle after the synchronous projection; the revision
  // is the shell's answer to `panel.notify()` and the only reason a view is
  // rebuilt without a query or data change.
  const [, bump] = React.useReducer((value) => value + 1, 0);

  const inputRef = React.useRef(null);
  const closeRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const previousFocus = React.useRef(null);
  const skipRestore = React.useRef(false);
  const rowRefs = React.useRef(new Map());
  const mountedRef = React.useRef(null);
  const reportedViewErrors = React.useRef(new Set());
  const queryRef = React.useRef(query);
  queryRef.current = query;
  const latest = React.useRef({ currentSessionId, activePanelId, pending });
  latest.current = { currentSessionId, activePanelId, pending };

  // Hover only moves the caret once the pointer really moved. Browsers replay
  // hover events for elements that appear under a stationary pointer, so an
  // unguarded hover would replace the opening row and could also steal the
  // caret when a query reflow puts another row under the same pointer.
  const hoverGate = React.useRef(null);
  if (hoverGate.current === null) {
    hoverGate.current = createPointerGate(getPointerBaseline());
  }

  const titleId = React.useId();
  const listId = React.useId();

  const closePanel = React.useCallback(
    (options = {}) => {
      skipRestore.current = options.restoreFocus === false;
      controller.close();
    },
    [controller],
  );

  /**
   * Replace the query in place, keeping the selection on a named row when the
   * module asks for it. The caret moves to the end when the next view is still a
   * list; a content view focuses its own surface and must not be scrolled away.
   */
  const applyQuery = React.useCallback((nextQuery, options = {}) => {
    setQuery(nextQuery);
    const mounted = mountedRef.current;
    if (mounted === null) return;
    const next = mounted.resolve(nextQuery);
    const rows = next.view.rows;
    if (next.view.content !== null) {
      setSelected(0);
      return;
    }
    const index =
      options.selectedKey === undefined
        ? -1
        : rows.findIndex((row) => String(row.key) === String(options.selectedKey));
    setSelected(index >= 0 ? index : firstContentIndex(rows));
    setCaretRequest((value) => value + 1);
  }, []);

  /**
   * Per-panel context handed to every mounted matcher and provider.
   *
   * The getters read the latest render's props, so a module that captured the
   * context once still sees the displayed session and the now clock change.
   */
  const panel = React.useMemo(
    () => ({
      get currentSessionId() {
        return latest.current.currentSessionId;
      },
      get activePanelId() {
        return latest.current.activePanelId;
      },
      get pending() {
        return latest.current.pending;
      },
      get now() {
        return Date.now();
      },
      get query() {
        return queryRef.current;
      },
      get previousFocus() {
        return previousFocus.current;
      },
      t,
      services,
      get,
      close: closePanel,
      setQuery: applyQuery,
      focusInput: () => inputRef.current?.focus(),
      notify: bump,
      setNotice,
      setError,
    }),
    [t, services, get, closePanel, applyQuery, bump],
  );

  const mounted = React.useMemo(() => registry.mount(panel), [registry, panel]);
  mountedRef.current = mounted;
  React.useEffect(() => () => mounted.dispose(), [mounted]);

  const resolved = mounted.resolve(query);
  const view = resolved.view;
  const rows = view.rows;
  // The default view is also the fallback when every matcher declined. Two
  // cases deserve a specific sentence: no module is switched on at all, and
  // the empty query reaches nothing because the default list is off.
  let emptyText = view.emptyText;
  if (resolved.matcherId === null) {
    const enabledModules = registry.modules().filter((module) => module.isEnabled !== false);
    if (enabledModules.length === 0) emptyText = t("panelAllModulesOff");
    else if (query === "") emptyText = t("panelNoDefaultList");
  }
  const contentShown = view.content !== null;
  const contentLookup = contentShown ? mounted.contentFor(view.content.kind) : null;
  const Content = contentLookup?.renderer.content ?? null;
  const footerLookup =
    contentShown && view.footer !== null ? mounted.contentFor(view.footer.kind) : null;
  const Footer = footerLookup?.renderer.footer ?? null;

  /** Log a broken view once per matcher and phase, then keep the panel alive. */
  const reportViewError = (phase, error) => {
    const key = `${resolved.matcherId}:${phase}`;
    if (reportedViewErrors.current.has(key)) return;
    reportedViewErrors.current.add(key);
    console.error(
      `[dsh-quick-switcher] matcher "${resolved.matcherId}" failed during ${phase}`,
      error,
    );
  };

  // Commands ask the controller which mode the panel shows; the shell is the
  // only place that knows what the current query resolved to.
  React.useEffect(() => {
    controller.setMode(resolved.matcherId);
  }, [controller, resolved.matcherId]);

  // The public snapshot carries the edited query; a command can use it to decide
  // whether the panel is already showing the mode it wants.
  React.useEffect(() => {
    controller.setQuery(query);
  }, [controller, query]);

  // A module that cannot answer synchronously returns empty rows plus a `load`
  // to run after render. The module dedupes by query, so a render caused by an
  // unrelated store change costs nothing. A throwing load is contained here so
  // one broken module cannot take the open panel down.
  React.useEffect(() => {
    try {
      view.load?.();
    } catch (error) {
      reportViewError("load", error);
    }
  }, [view]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement;
    const input = inputRef.current;
    if (input) {
      input.focus();
      // An empty seed is a blank search box, so selecting it all costs nothing.
      // A seeded query is a prefix the user continues from, and selecting it
      // would let the first typed character replace the mode.
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
    // The panel mounts once per open; a reseed does not remount it.
  }, []);

  // The caret follows a token a row just inserted. React updates the value from
  // state, but only an explicit range keeps the caret at the end.
  React.useEffect(() => {
    if (caretRequest === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
  }, [caretRequest]);

  // Leaving the detail puts the caret back in the input, which is again the only
  // control that can change the query. Entering the detail focuses the answer
  // itself, so this direction is deliberately one-way.
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

  // Escape is caught at the document level as well: focus can sit in the
  // detail's answer area, outside the card's own key handler.
  React.useEffect(() => {
    const onDocumentKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      controller.close();
    };
    document.addEventListener("keydown", onDocumentKeyDown, false);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, false);
  }, [controller]);

  /**
   * Run one row's closure. An action owns its own errors; the shell only keeps a
   * throw from escaping the React event handler, and reports a generic failure
   * because there is no other surface left while the panel stays open.
   */
  const runRow = (row, shiftKey) => {
    const runner = shiftKey ? (row.shiftRun ?? row.run) : row.run;
    if (typeof runner !== "function") return;
    try {
      const result = runner();
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        result.catch((failure) => {
          console.error("[dsh-quick-switcher] row action failed", failure);
          setError(t("coreActionFailed"));
        });
      }
    } catch (failure) {
      console.error("[dsh-quick-switcher] row action failed", failure);
      setError(t("coreActionFailed"));
    }
  };

  const onQueryChange = (value) => {
    const next = mounted.resolve(value);
    setQuery(value);
    setError(null);
    setNotice(null);
    setSelected(firstContentIndex(next.view.rows));
  };

  const onKeyDown = (event) => {
    if (event.nativeEvent?.isComposing || event.isComposing) return;
    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      // A content view adds its own focusables, so the cycle is read from the
      // card instead of being fixed to the input and the close button.
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
      // The module owns the detail's letters; the shell only respects the
      // handled flag and never moves the hidden list's caret underneath it.
      let handled = false;
      try {
        handled =
          typeof view.keydown === "function" ? view.keydown(event, panel) === true : false;
      } catch (error) {
        reportViewError("keydown", error);
      }
      if (handled) event.preventDefault();
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
      // Swallow the key even when no such row exists: on macOS Alt+digit types a
      // symbol, and an out-of-range press must not edit the query.
      event.preventDefault();
      event.stopPropagation();
      const row = rows[digitIndex];
      if (!row) return;
      setSelected(digitIndex);
      // Shift is ignored on purpose: layouts that need Shift for a plain digit
      // would otherwise fire the alternate action instead of the primary one.
      runRow(row, false);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      const row = rows[selected];
      if (!row) return;
      runRow(row, event.shiftKey);
    }
  };

  const hints = [{ keys: ["↑", "↓"], label: t("hintSelect") }, ...view.hints];
  const activeId = rows.length === 0 ? undefined : `dqs-option-${selected}`;
  const locked = view.inputLocked === true;

  const children = [];
  if (rows.length === 0) {
    if (emptyText) {
      children.push(h("div", { className: "dqs-empty", key: "empty" }, emptyText));
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
          onActivate: (shiftKey) => runRow(row, shiftKey),
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

  const body = contentShown
    ? h(
        "div",
        { key: "body", className: "dqs-content" },
        Content === null
          ? h("div", { className: "dqs-empty" }, t("coreMissingView"))
          : h(Content, {
              key: view.content.kind,
              descriptor: view.content,
              instance: contentLookup.instance,
              panel,
              t,
            }),
      )
    : h(
        "div",
        {
          key: "body",
          className: "dqs-list",
          id: listId,
          role: "listbox",
          "aria-label": view.listLabel,
        },
        children,
      );

  const footer = contentShown
    ? Footer === null
      ? null
      : h(Footer, {
          key: "content-footer",
          descriptor: view.footer,
          instance: footerLookup.instance,
          panel,
          t,
        })
    : [
        h(Hints, { key: "hints", hints }),
        h("div", { key: "count", className: "dqs-count" }, view.count),
      ];

  const cardChildren = [
    h("style", { key: "style" }, STYLE),
    h("div", { key: "title", className: "dqs-sr-only", id: titleId }, t("title")),
    h(
      "div",
      { key: "search", className: "dqs-search" },
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
          onClick: () => closePanel(),
        },
        h(CloseGlyph),
      ),
    ),
    body,
    notice === null
      ? null
      : h("div", { key: "notice", className: "dqs-notice", role: "status" }, notice),
    error === null ? null : h("div", { key: "error", className: "dqs-error", role: "alert" }, error),
    h("div", { key: "footer", className: "dqs-footer" }, footer),
  ];

  // Providers nest from the lowest order outward, so a module can publish a
  // React context that later modules and its own matcher components read.
  const nested = mounted
    .providers()
    .reduceRight(
      (childrenNode, entry) =>
        h(
          entry.Component,
          { key: `provider:${entry.moduleId}`, instance: entry.instance, panel },
          childrenNode,
        ),
      cardChildren,
    );

  return h(
    "div",
    {
      className: "dqs-overlay",
      role: "presentation",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          closePanel();
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
      nested,
    ),
  );
}
