/* The settings picker: a DSH-style trigger and its anchored menu. */

import React from "react";
import {
  filterMenuItems,
  firstSelectableKey,
  lastSelectableKey,
  placeMenu,
  stepActiveKey,
} from "./menu.js";

const h = React.createElement;

/**
 * Trigger and menu styles.
 *
 * Values come from DSH's own model trigger and menu in the chat composer: the
 * trigger is borderless, 28px high, 13px text at the caption-secondary color,
 * with the hover wash and keyboard ring the rest of DSH uses. The menu copies the
 * official surface: 16px radius, translucent fill, blurred material, prominent
 * shadow, 4px padding, and 34px rows with a 12px radius. Everything reads the
 * theme tokens with a literal fallback so an older DSH still renders.
 */
const STYLE = `
.dqs-ask-trigger {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family, var(--dsh-font-family-text-default, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif));
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dqs-ask-trigger:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dqs-ask-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dqs-ask-triggerLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dqs-ask-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}
.dqs-ask-chevronOpen {
  transform: rotate(180deg);
}
.dqs-ask-menu {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: none;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1, #fff));
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, var(--dsh-font-family-text-default, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif));
  font-size: 13px;
  box-shadow: var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)), 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  overflow: hidden;
}
.dqs-ask-search {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  margin: 0 0 2px;
  padding: 5px 7px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  outline: none;
}
.dqs-ask-search:focus {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dqs-ask-search::placeholder {
  color: var(--dsw-alias-label-dimmed);
}
.dqs-ask-menuList {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dqs-ask-menuList:focus-visible {
  outline: none;
}
.dqs-ask-menuHeader {
  padding: 6px 8px 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dqs-ask-option {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 5px 7px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dqs-ask-optionActive {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dqs-ask-option:focus-visible {
  outline: none;
}
.dqs-ask-optionLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dqs-ask-check {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-label-primary);
}
`;

/** The trigger chevron, pointing down and rotating while the menu is open. */
function Chevron({ isOpen }) {
  return h(
    "svg",
    {
      className: isOpen ? "dqs-ask-chevron dqs-ask-chevronOpen" : "dqs-ask-chevron",
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M2.5 4.5 L6 8 L9.5 4.5",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

/** The check mark on the selected row. */
function Check() {
  return h(
    "svg",
    {
      className: "dqs-ask-check",
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M2 6.5 L4.75 9 L10 3.5",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}

/** Turn a placement result into the fixed-position style the menu needs. */
function menuStyle(placement) {
  const style = {
    left: `${placement.left}px`,
    width: `${placement.width}px`,
    maxHeight: `${placement.maxHeight}px`,
  };
  if (placement.top === undefined) style.bottom = `${placement.bottom}px`;
  else style.top = `${placement.top}px`;
  return style;
}

/**
 * A settings control that opens a menu instead of a native select.
 *
 * Native selects cannot show a provider header without the system menu's bold
 * italic labels, cannot show a search field, and paint a checkmark only in the
 * system style. The menu is rendered in place with `position: fixed`, so an
 * ancestor's overflow does not clip it; the page scrolling or resizing closes it
 * rather than leaving it detached from its trigger.
 *
 * Rows are buttons with `tabIndex: -1`; focus stays on the search field or the
 * list, which keeps the arrow keys under the menu's own handler and the tab
 * order unchanged. The trigger regains focus when the menu closes by keyboard or
 * by a selection; a click elsewhere keeps the focus where the user put it.
 */
export function Picker({
  ariaLabel,
  menuLabel,
  label,
  items,
  selectedKey,
  onSelect,
  searchPlaceholder,
  searchAriaLabel,
}) {
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const listRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const [isOpen, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeKey, setActiveKey] = React.useState(null);
  const [placement, setPlacement] = React.useState(null);

  const isSearchable = typeof searchPlaceholder === "string" && searchPlaceholder !== "";
  const visible = isSearchable ? filterMenuItems(items, query) : items;

  const close = React.useCallback((restoreFocus) => {
    setOpen(false);
    setQuery("");
    setPlacement(null);
    if (restoreFocus === true) triggerRef.current?.focus();
  }, []);

  const choose = (key) => {
    if (key === null || key === undefined) return;
    // A row filtered out of the visible list must not be selectable through a
    // stale active key, which can happen when the catalog arrives mid-menu.
    if (!visible.some((item) => item.kind !== "header" && item.key === key)) return;
    onSelect(key);
    close(true);
  };

  const toggle = () => {
    if (isOpen) {
      close(true);
      return;
    }
    setOpen(true);
    setQuery("");
    setActiveKey(
      items.some((item) => item.key === selectedKey && item.kind !== "header")
        ? selectedKey
        : firstSelectableKey(items),
    );
  };

  // Where the menu goes is measured once per open: the trigger does not move
  // while the menu is up because any page scroll closes it.
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    setPlacement(
      placeMenu(
        { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
        { width: window.innerWidth, height: window.innerHeight },
        // Wider than the trigger so a full model name fits; still inside the
        // official menu range of 240 to 420.
        { minWidth: 280, maxWidth: 420 },
      ),
    );
  }, [isOpen]);

  // Focus lands on the search field, or on the list when the menu has no search.
  React.useLayoutEffect(() => {
    if (!isOpen || placement === null) return;
    const node = isSearchable ? searchRef.current : listRef.current;
    node?.focus();
  }, [isOpen, placement, isSearchable]);

  // Keep the active row in view while the arrow keys or the query move it.
  React.useLayoutEffect(() => {
    if (!isOpen || placement === null) return;
    const node = menuRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [isOpen, placement, activeKey]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      close(false);
    };
    const onScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen, close]);

  const onMenuKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveKey(stepActiveKey(visible, activeKey, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveKey(stepActiveKey(visible, activeKey, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveKey(firstSelectableKey(visible));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveKey(lastSelectableKey(visible));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(activeKey);
      return;
    }
    if (event.key === "Tab") {
      // Hand the focus back to the trigger before the browser moves on, so the
      // tab order continues from the control instead of from the removed menu.
      close(true);
    }
  };

  const onQueryChange = (event) => {
    const next = event.target.value;
    setQuery(next);
    setActiveKey(firstSelectableKey(filterMenuItems(items, next)));
  };

  const rows = [];
  let activeId;
  for (const item of visible) {
    if (item.kind === "header") {
      rows.push(
        h("div", { key: item.key, className: "dqs-ask-menuHeader", role: "presentation" }, item.label),
      );
      continue;
    }
    const isSelected = item.key === selectedKey;
    const isActive = item.key === activeKey;
    const optionId = `${listId}-${rows.length}`;
    if (isActive) activeId = optionId;
    rows.push(
      h(
        "button",
        {
          key: item.key,
          id: optionId,
          type: "button",
          role: "option",
          tabIndex: -1,
          "aria-selected": isSelected,
          "data-active": isActive ? "true" : undefined,
          className: isActive ? "dqs-ask-option dqs-ask-optionActive" : "dqs-ask-option",
          title: item.label,
          onMouseEnter: () => setActiveKey(item.key),
          onClick: () => choose(item.key),
        },
        h("span", { className: "dqs-ask-optionLabel" }, item.label),
        isSelected ? h(Check, null) : null,
      ),
    );
  }

  return h(
    React.Fragment,
    null,
    h("style", null, STYLE),
    h(
      "button",
      {
        ref: triggerRef,
        type: "button",
        className: "dqs-ask-trigger",
        "aria-label": ariaLabel,
        "aria-haspopup": "listbox",
        "aria-expanded": isOpen,
        "aria-controls": isOpen ? listId : undefined,
        title: label,
        onClick: toggle,
      },
      h("span", { className: "dqs-ask-triggerLabel" }, label),
      h(Chevron, { isOpen }),
    ),
    isOpen && placement !== null
      ? h(
          "div",
          {
            ref: menuRef,
            className: "dqs-ask-menu",
            style: menuStyle(placement),
            onKeyDown: onMenuKeyDown,
          },
          isSearchable
            ? h("input", {
                ref: searchRef,
                className: "dqs-ask-search",
                type: "text",
                role: "combobox",
                "aria-expanded": true,
                "aria-controls": listId,
                "aria-activedescendant": activeId,
                "aria-autocomplete": "list",
                value: query,
                placeholder: searchPlaceholder,
                "aria-label": searchAriaLabel,
                autoComplete: "off",
                spellCheck: false,
                onChange: onQueryChange,
              })
            : null,
          h(
            "div",
            {
              ref: listRef,
              id: listId,
              className: "dqs-ask-menuList",
              role: "listbox",
              "aria-label": menuLabel,
              "aria-activedescendant": activeId,
              tabIndex: -1,
            },
            rows,
          ),
        )
      : null,
  );
}
