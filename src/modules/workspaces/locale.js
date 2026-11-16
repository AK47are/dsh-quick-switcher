/* Workspace module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "placeholderWorkspaces",
  "searchAriaWorkspaces",
  "listLabelWorkspaces",
  "emptyWorkspaces",
  "emptyWorkspaceSessions",
  "newSession",
  "placeholderScope",
  "listLabelScope",
  "searchAria",
  "hintViewSessions",
  "hintNewSession",
  "hintOpen",
  "count",
  "countWorkspaces",
  "empty",
  "createFailed",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.workspacesTitle = "工作区";
locale.en.workspacesTitle = "Workspaces";
