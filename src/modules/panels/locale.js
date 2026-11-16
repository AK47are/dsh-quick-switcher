/* Main-panel module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "placeholderPanels",
  "searchAriaPanels",
  "listLabelPanels",
  "emptyPanels",
  "emptyPanelMatches",
  "panelOpenFailed",
  "current",
  "hintOpen",
  "countPanels",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.panelsTitle = "主面板";
locale.en.panelsTitle = "Panels";
