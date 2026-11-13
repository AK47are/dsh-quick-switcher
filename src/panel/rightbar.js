/* Focus continuity into the right Sidebar after the panel opens a file. */

/**
 * Focus the right Sidebar pane that now shows the opened file.
 *
 * The column expands and the document tab commits after the panel closes, so
 * the pane can be absent for a frame or two; this retries briefly instead of
 * guessing a delay. The visibility rule is the one DSH uses for its own pane
 * opens: a pane belongs to the on-screen Session, is not inside a hidden
 * ancestor, and is either floating or inside an open column.
 *
 * Focus is best effort: if the column never appears, the panel simply leaves
 * the focus where it was instead of stealing it.
 */
export function focusSidebarPane(document, sessionId) {
  if (typeof document === "undefined" || sessionId === null || sessionId === undefined) {
    return;
  }
  let frames = 0;
  const attempt = () => {
    const pane = visiblePane(document, sessionId);
    if (pane !== undefined) {
      pane.focus?.({ preventScroll: true });
      return;
    }
    frames += 1;
    if (frames < 20) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

function visiblePane(document, sessionId) {
  const wanted = String(sessionId);
  const panes = [
    ...document.querySelectorAll("[data-dockkit-pane], [data-dockkit-float]"),
  ].filter((pane) => {
    const owner = pane.closest("[data-sidebar-right-session]");
    return (
      owner?.dataset.sidebarRightSession === wanted &&
      pane.closest('[hidden], [aria-hidden="true"]') === null &&
      (pane.hasAttribute("data-dockkit-float") ||
        owner.hasAttribute("data-sidebar-right-open"))
    );
  });
  return (
    panes.find(
      (pane) =>
        pane.hasAttribute("data-dockkit-pane-active") ||
        pane.hasAttribute("data-dockkit-float-active"),
    ) ?? panes[0]
  );
}
