import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

// Invisible characters typed raw into source code (NUL and other C0 controls,
// DEL / C1 controls, zero-width characters) make git and GitHub treat the file
// as binary, so its PR diff becomes unreadable — and they are invisible in
// review. Source must spell such characters as JavaScript unicode escapes
// (backslash + "u" + 4 hex digits) or build them with String.fromCharCode.

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SOURCE_DIRS = ["scripts", "src"];
const SOURCE_FILE = /\.(mjs|cjs|js|ts|tsx)$/;
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

function isForbidden(cp) {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false;
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || ZERO_WIDTH.has(cp);
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

test("isForbidden flags C0 (except tab/LF/CR), DEL, C1 and zero-width code points only", () => {
  assert.deepEqual(
    [0x00, 0x07, 0x0b, 0x1f, 0x7f, 0x85, 0x9f, 0x200b, 0x2060, 0xfeff].map(isForbidden),
    Array(10).fill(true)
  );
  assert.deepEqual([0x09, 0x0a, 0x0d, 0x20, 0x41, 0xa0, 0x3042, 0x2014].map(isForbidden), Array(8).fill(false));
});

test("source files contain no raw control or zero-width characters (write unicode escapes instead)", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(root, dir)));
  assert.ok(files.some((f) => f.endsWith("youtube-caption.mjs")), "scans scripts/");
  assert.ok(files.some((f) => f.endsWith(".tsx")), "scans src/");

  const offenders = [];
  for (const file of files) {
    let line = 1;
    for (const ch of readFileSync(file, "utf8")) {
      const cp = ch.codePointAt(0);
      if (cp === 0x0a) line += 1;
      else if (isForbidden(cp)) {
        offenders.push(`${relative(root, file)}:${line} U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
