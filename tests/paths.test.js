import assert from "node:assert/strict";
import test from "node:test";
import {
  inferStyle,
  isAbsolutePath,
  isRootPath,
  joinPath,
  normalizeForCompare,
  parentWithSeparator,
  splitLastSegment,
  stripTrailingSeparators,
  withTrailingSeparator,
} from "../src/core/lib/paths.js";

test("a path grammar is inferred from the first separator", () => {
  assert.equal(inferStyle("C:\\Users\\ASUS1"), "win32");
  assert.equal(inferStyle("\\\\server\\share"), "win32");
  assert.equal(inferStyle("/home/user"), "posix");
  assert.equal(inferStyle("work"), null);
  assert.equal(inferStyle(""), null);
});

test("absolute paths follow their grammar", () => {
  assert.equal(isAbsolutePath("C:\\Users", "win32"), true);
  assert.equal(isAbsolutePath("C:/Users", "win32"), true);
  assert.equal(isAbsolutePath("\\\\server\\share", "win32"), true);
  assert.equal(isAbsolutePath("\\Users", "win32"), false);
  assert.equal(isAbsolutePath("/home/user", "posix"), true);
  assert.equal(isAbsolutePath("home/user", "posix"), false);
});

test("roots keep one spelling and no extra separator", () => {
  assert.equal(stripTrailingSeparators("C:\\"), "C:\\");
  assert.equal(stripTrailingSeparators("C:"), "C:\\");
  assert.equal(stripTrailingSeparators("C:\\Users\\"), "C:\\Users");
  assert.equal(stripTrailingSeparators("\\\\server\\share\\"), "\\\\server\\share");
  assert.equal(stripTrailingSeparators("/"), "/");
  assert.equal(stripTrailingSeparators("//"), "/");
  assert.equal(withTrailingSeparator("C:\\Users"), "C:\\Users\\");
  assert.equal(withTrailingSeparator("C:"), "C:\\");
  assert.equal(withTrailingSeparator("/home"), "/home/");
  assert.equal(withTrailingSeparator("\\\\server\\share"), "\\\\server\\share\\");
});

test("the parent of a directory always ends with a separator", () => {
  assert.equal(parentWithSeparator("C:\\Users\\ASUS1\\a"), "C:\\Users\\ASUS1\\");
  assert.equal(parentWithSeparator("C:\\Users"), "C:\\");
  assert.equal(parentWithSeparator("C:\\"), "C:\\");
  assert.equal(parentWithSeparator("/work"), "/");
  assert.equal(parentWithSeparator("/"), "/");
  assert.equal(parentWithSeparator("\\\\server\\share"), "\\\\server\\share\\");
  assert.equal(parentWithSeparator("a"), null);
  assert.equal(parentWithSeparator(""), null);
});

test("the last segment split reports roots and final names", () => {
  assert.deepEqual(splitLastSegment("C:\\Users\\a"), {
    parent: "C:\\Users\\",
    name: "a",
    isRoot: false,
  });
  assert.deepEqual(splitLastSegment("C:\\"), { parent: "C:\\", name: "", isRoot: true });
  assert.deepEqual(splitLastSegment("/home/"), { parent: "/", name: "home", isRoot: false });
  assert.deepEqual(splitLastSegment("\\\\server\\share"), {
    parent: "\\\\server\\share",
    name: "",
    isRoot: true,
  });
  assert.equal(isRootPath("C:\\"), true);
  assert.equal(isRootPath("C:\\Users"), false);
  assert.equal(isRootPath("/"), true);
});

test("joining one segment keeps the directory's spelling", () => {
  assert.equal(joinPath("C:\\Users", "a"), "C:\\Users\\a");
  assert.equal(joinPath("C:\\Users\\", "a"), "C:\\Users\\a");
  assert.equal(joinPath("C:\\", "\\a"), "C:\\a");
  assert.equal(joinPath("/home", "a"), "/home/a");
  assert.equal(joinPath("/home/", "a"), "/home/a");
  assert.equal(joinPath("", "a"), "a");
});

test("comparison folds case and separators on Windows only", () => {
  assert.equal(
    normalizeForCompare("C:/Users/ASUS1/", "win32"),
    normalizeForCompare("c:\\users\\asus1", "win32"),
  );
  assert.notEqual(
    normalizeForCompare("/home/User", "posix"),
    normalizeForCompare("/home/user", "posix"),
  );
  assert.equal(normalizeForCompare("/home/user/", "posix"), "/home/user");
});
