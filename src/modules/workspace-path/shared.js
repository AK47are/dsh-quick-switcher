/* Protocol shared by the workspace-path client and its host half. */

export const LIST_PATH = "/dsh-quick-switcher/paths";
export const MKDIR_PATH = "/dsh-quick-switcher/paths/mkdir";

/** One directory listing stops after this many subdirectories. */
export const MAX_ENTRIES = 500;

/** Bound for a typed path; longer text is a paste accident, not a path. */
export const MAX_PATH_CHARS = 4096;
