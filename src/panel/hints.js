/* Footer key hints. */

import React from "react";
import { Keycap } from "./rows.js";

const h = React.createElement;

/** Render one keycap group per hint. */
export function Hints({ hints }) {
  return h(
    "div",
    { className: "dqs-hints" },
    hints.map((hint, index) =>
      h(
        "span",
        { className: "dqs-hint", key: index },
        ...hint.keys.map((key, keyIndex) => h(Keycap, { key: keyIndex }, key)),
        h("span", null, hint.label),
      ),
    ),
  );
}
