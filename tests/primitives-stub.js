/* The DSH client primitives a UI module touches, stubbed for node tests.
 *
 * MarkdownText is a sentinel string rather than a component because these tests
 * never render it: they only check which element the panel chose and with which
 * props. The host supplies the real component at runtime, so the stub must not
 * imitate its behavior. */

export const MarkdownText = "MarkdownText";

export const StateDot = "StateDot";
