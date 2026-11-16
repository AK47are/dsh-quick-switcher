/* Command module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "placeholderCommands",
  "searchAriaCommands",
  "listLabelCommands",
  "emptyCommands",
  "emptyCommandMatches",
  "loadingCommands",
  "recentBadge",
  "commandMissing",
  "commandBlocked",
  "commandFailed",
  "hintRunCommand",
  "countCommands",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.commandsTitle = "命令";
locale.en.commandsTitle = "Commands";
