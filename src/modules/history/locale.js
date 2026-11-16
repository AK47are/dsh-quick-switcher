/* History module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "historyCommandLabel",
  "placeholderHistory",
  "searchAriaHistory",
  "listLabelHistory",
  "emptyHistory",
  "emptyHistoryMatches",
  "historyDraftBadge",
  "historySteeringBadge",
  "historyAnswerBadge",
  "historyLoadEarlier",
  "historyLoading",
  "historyApplied",
  "historyApplyFailed",
  "historyLoadFailed",
  "historyFrozen",
  "historyNoSession",
  "hintFill",
  "countHistory",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.historyTitle = "历史";
locale.en.historyTitle = "History";
