/* File module copy, sliced from the shared dictionary during the migration. */

import { pickLocale } from "../../core/lib/locale-slice.js";
import { en as allEn, zh as allZh } from "../../i18n.js";

const KEYS = [
  "placeholderFiles",
  "searchAriaFiles",
  "listLabelFiles",
  "filesLoading",
  "filesEmpty",
  "filesFailed",
  "filesFailedWithReason",
  "filesNoSession",
  "countFiles",
  "fileOpenFailed",
  "hintFilesOpen",
  "hintFilesPreview",
];

export const locale = pickLocale(allZh, allEn, KEYS);
locale.zh.filesTitle = "文件";
locale.en.filesTitle = "Files";
