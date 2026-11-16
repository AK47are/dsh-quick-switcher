/* Session module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "placeholder",
  "searchAria",
  "listLabel",
  "empty",
  "current",
  "previous",
  "count",
  "openFailed",
  "hintOpen",
  "hintWorkspaceMode",
  "hintCommandMode",
  "hintFileMode",
  "hintHistoryMode",
  "hintPanelMode",
  "hintAskMode",
  "statusIdle",
  "statusRunning",
  "statusSubagentsOne",
  "statusSubagentsOther",
  "statusCompleted",
  "statusWaitingApproval",
  "statusPlanReview",
  "statusWaitingAnswer",
  "statusCompactApproval",
  "statusCompactPlanReview",
  "statusCompactAnswer",
  "settingsPendingOrderTitle",
  "settingsPendingOrderDescription",
  "settingsPendingOrderHint",
  "settingsPendingOrderLeastRecent",
  "settingsPendingOrderMostRecent",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.sessionsTitle = "会话";
locale.en.sessionsTitle = "Sessions";
