import assert from "node:assert/strict";
import test from "node:test";
import { fileAddress, splitFilePath } from "../src/data/files.js";

test("splitFilePath returns the parent directory and the raw name", () => {
  assert.deepEqual(splitFilePath("src/components/App.tsx"), {
    directory: "src/components",
    name: "App.tsx",
  });
  assert.deepEqual(splitFilePath("README.md"), { directory: "", name: "README.md" });
});

test("splitFilePath normalizes backslashes and drops trailing separators", () => {
  assert.deepEqual(splitFilePath("src\\main.js"), { directory: "src", name: "main.js" });
  assert.deepEqual(splitFilePath("src/"), { directory: "", name: "src" });
  assert.deepEqual(splitFilePath("src/nested/"), {
    directory: "src",
    name: "nested",
  });
});

test("fileAddress encodes the session and each path segment", () => {
  assert.equal(
    fileAddress("s-1", "src/my file.ts"),
    "dsh-resource://file/session/s-1/src/my%20file.ts",
  );
});

test("fileAddress keeps drive colons literal and drops leading ./", () => {
  assert.equal(
    fileAddress("s 1", "./C:\\work\\a.ts"),
    "dsh-resource://file/session/s%201/C:/work/a.ts",
  );
});

test("fileAddress ignores empty segments", () => {
  assert.equal(
    fileAddress("s1", "//src//a.ts"),
    "dsh-resource://file/session/s1/src/a.ts",
  );
});
