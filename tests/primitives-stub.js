/* The DSH client primitives a UI module touches, stubbed for node tests.
 *
 * Each export is a sentinel string rather than a component because these tests
 * never render it: they only check which element the panel chose and with which
 * props. The host supplies the real components at runtime, so the stub must not
 * imitate their behavior. */

export const MarkdownText = "MarkdownText";

export const StateDot = "StateDot";

/* The reasoning disclosure a detail block builds from; sentinels keep the test
 * assertions on element type and props rather than on rendered output. */
export const DisclosureRow = "DisclosureRow";

export const TextShimmer = "TextShimmer";

export const IconThinkOutlineRegular = "IconThinkOutlineRegular";
