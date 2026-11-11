import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function message(content: string) {
  const directory = mkdtempSync(join(tmpdir(), "dv-commit-msg-"));
  directories.push(directory);
  const file = join(directory, "message");
  writeFileSync(file, content);
  return file;
}

function run(file: string) {
  return () => execFileSync("sh", [".husky/commit-msg", file], { cwd: process.cwd(), stdio: "pipe" });
}

it("enforces Conventional Commit messages through the Husky hook", () => {
  expect(run(message("fix(cli): pass hook message path\n"))).not.toThrow();
  expect(run(message("not conventional\n"))).toThrow();
});
