import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliRuntimeChangedFileGitSnapshotReader,
  esGitRuntimeChangedFileGitSnapshotReader,
  type RuntimeChangedFileGitSnapshotReader,
  type RuntimeChangedFileGitSnapshotStage,
} from "../lib/runtime/changed-file-git-snapshot-reader.js";
import { openRuntimeSqliteStore } from "../lib/runtime/sqlite-store.js";

const temporaryDirectories: string[] = [];

const readers: Array<[string, RuntimeChangedFileGitSnapshotReader]> = [
  ["CLI", cliRuntimeChangedFileGitSnapshotReader],
  ["es-git", esGitRuntimeChangedFileGitSnapshotReader],
];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function git(rootDir: string, args: string[]): void {
  execFileSync("git", args, { cwd: rootDir, stdio: "ignore" });
}

function gitOutput(rootDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

async function createRepository(): Promise<string> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-runtime-git-snapshot-"),
  );
  temporaryDirectories.push(rootDir);
  git(rootDir, ["init", "--initial-branch", "main"]);
  git(rootDir, ["config", "user.email", "snapshot@example.com"]);
  git(rootDir, ["config", "user.name", "Snapshot"]);
  await fs.mkdir(path.join(rootDir, "backlog"));
  await fs.writeFile(path.join(rootDir, "backlog", "rename-source.md"), "rename source\n");
  await fs.writeFile(path.join(rootDir, "backlog", "case-name.md"), "case source\n");
  await fs.writeFile(path.join(rootDir, "backlog", "copy-source.md"), "copy source\n");
  await fs.writeFile(path.join(rootDir, "backlog", "conflict.md"), "base\n");
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "chore: base"]);
  return rootDir;
}

function commit(rootDir: string, message: string): void {
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", message]);
}

function nameStatusEntries(raw: string | undefined): string[][] {
  const tokens = (raw ?? "").split("\0").filter(Boolean);
  const entries: string[][] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]\d+$/.test(status)) {
      entries.push([status, tokens[index++], tokens[index++]]);
    } else {
      entries.push([status, tokens[index++]]);
    }
  }
  return entries;
}

async function createRenameFixture(caseOnly = false): Promise<string> {
  const rootDir = await createRepository();
  git(rootDir, ["switch", "-c", "feature/rename"]);
  if (caseOnly) {
    git(rootDir, ["mv", "backlog/case-name.md", "backlog/case-rename-temporary.md"]);
    git(rootDir, ["mv", "backlog/case-rename-temporary.md", "backlog/Case-Name.md"]);
  } else {
    git(rootDir, ["mv", "backlog/rename-source.md", "backlog/renamed.md"]);
  }
  commit(rootDir, "feat: rename snapshot file");
  return rootDir;
}

async function createCopyFixture(): Promise<string> {
  const rootDir = await createRepository();
  git(rootDir, ["switch", "-c", "feature/copy"]);
  await fs.copyFile(
    path.join(rootDir, "backlog", "copy-source.md"),
    path.join(rootDir, "backlog", "copied.md"),
  );
  commit(rootDir, "feat: copy snapshot file");
  return rootDir;
}

async function createStaleTargetFixture(): Promise<string> {
  const rootDir = await createRepository();
  git(rootDir, ["switch", "-c", "feature/stale"]);
  await fs.appendFile(path.join(rootDir, "backlog", "rename-source.md"), "feature\n");
  commit(rootDir, "feat: feature change");
  git(rootDir, ["switch", "main"]);
  await fs.appendFile(path.join(rootDir, "backlog", "copy-source.md"), "main\n");
  commit(rootDir, "feat: main advances");
  git(rootDir, ["switch", "feature/stale"]);
  return rootDir;
}

async function createConflictFixture(): Promise<string> {
  const rootDir = await createRepository();
  git(rootDir, ["switch", "-c", "feature/conflict"]);
  await fs.writeFile(path.join(rootDir, "backlog", "conflict.md"), "feature\n");
  commit(rootDir, "feat: feature conflict");
  git(rootDir, ["switch", "main"]);
  await fs.writeFile(path.join(rootDir, "backlog", "conflict.md"), "main\n");
  commit(rootDir, "feat: main conflict");
  git(rootDir, ["switch", "feature/conflict"]);
  return rootDir;
}

async function createLinkedWorktreeFixture(): Promise<string> {
  const rootDir = await createRepository();
  const worktreeDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "doc-vader-runtime-git-snapshot-worktree-"),
  );
  temporaryDirectories.push(worktreeDir);
  git(rootDir, ["worktree", "add", "-b", "feature/linked-snapshot", worktreeDir, "main"]);
  return worktreeDir;
}

describe("runtime changed-file Git snapshot readers", () => {
  for (const [name, reader] of readers) {
    describe(`${name} snapshot-reader contract`, () => {
      it("reads a linked worktree", async () => {
        const rootDir = await createLinkedWorktreeFixture();
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(snapshot.headRef?.trim()).toBe("feature/linked-snapshot");
        expect(snapshot.headSha?.trim()).toMatch(/^[a-f0-9]{40}$/);
      });

      it("reports an R-status rename with correctly ordered prior and new paths", async () => {
        const rootDir = await createRenameFixture();
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(nameStatusEntries(snapshot.branchDiff)).toContainEqual([
          "R100",
          "backlog/rename-source.md",
          "backlog/renamed.md",
        ]);
        expect(snapshot.mergeTreeOutput).not.toMatch(/changed in both|<<<<<<<|>>>>>>>/);
      });

      it("reports a case-only rename with correctly ordered prior and new paths", async () => {
        const rootDir = await createRenameFixture(true);
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(nameStatusEntries(snapshot.branchDiff)).toContainEqual([
          "R100",
          "backlog/case-name.md",
          "backlog/Case-Name.md",
        ]);
      });

      it("leaves an added copy as A rather than promoting it to a copy status", async () => {
        const rootDir = await createCopyFixture();
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(nameStatusEntries(snapshot.branchDiff)).toContainEqual(["A", "backlog/copied.md"]);
        expect(nameStatusEntries(snapshot.branchDiff).some(([status]) => status.startsWith("C"))).toBe(false);
      });

      it("reports the current merge target separately from a stale merge base", async () => {
        const rootDir = await createStaleTargetFixture();
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(snapshot.mergeTargetSha?.trim()).toBe(gitOutput(rootDir, ["rev-parse", "main"]));
        expect(snapshot.mergeBaseSha?.trim()).not.toBe(snapshot.mergeTargetSha?.trim());
      });

      it("reports a non-empty merge-tree conflict result", async () => {
        const rootDir = await createConflictFixture();
        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(snapshot.mergeTreeOutput).toMatch(/changed in both|<<<<<<<|>>>>>>>/);
      });

      it("keeps a staged-and-modified new path in the HEAD worktree diff, not untracked output", async () => {
        const rootDir = await createRepository();
        await fs.writeFile(path.join(rootDir, "backlog", "staged-then-modified.md"), "staged\n");
        git(rootDir, ["add", "backlog/staged-then-modified.md"]);
        await fs.appendFile(path.join(rootDir, "backlog", "staged-then-modified.md"), "worktree\n");

        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(nameStatusEntries(snapshot.worktreeDiff)).toContainEqual([
          "A",
          "backlog/staged-then-modified.md",
        ]);
        expect(snapshot.untracked).not.toContain("backlog/staged-then-modified.md");
      });

      it("reports tracked worktree modifications and untracked paths", async () => {
        const rootDir = await createRepository();
        await fs.appendFile(path.join(rootDir, "backlog", "rename-source.md"), "worktree\n");
        await fs.writeFile(path.join(rootDir, "backlog", "untracked.md"), "untracked\n");

        const snapshot = await reader.readSnapshot({ rootDir, mergeTargetRef: "main" });

        expect(nameStatusEntries(snapshot.worktreeDiff)).toContainEqual([
          "M",
          "backlog/rename-source.md",
        ]);
        expect(snapshot.untracked).toContain("backlog/untracked.md");
      });

      it("returns a silent empty snapshot while tracing every attempted unavailable fact", async () => {
        const rootDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "doc-vader-runtime-git-snapshot-unavailable-"),
        );
        temporaryDirectories.push(rootDir);
        const calls: RuntimeChangedFileGitSnapshotStage[] = [];
        const outcomes: Array<[RuntimeChangedFileGitSnapshotStage, "value" | "undefined"]> = [];
        const snapshot = await reader.readSnapshot({
          rootDir,
          mergeTargetRef: "main",
          trace: {
            trace: async (stage, operation) => {
              calls.push(stage);
              return operation();
            },
            recordOutcome: (stage, outcome) => outcomes.push([stage, outcome]),
          },
        });

        expect(snapshot).toEqual({});
        expect(calls).toEqual([
          "gitChangedFilesHeadRef",
          "gitChangedFilesHead",
          "gitChangedFilesMergeTarget",
          "gitChangedFilesBranchDiff",
          "gitChangedFilesWorktreeDiff",
          "gitChangedFilesUntracked",
        ]);
        expect(outcomes).toEqual(calls.map((stage) => [stage, "undefined"]));
      });
    });
  }

  it("uses the es-git reader as the RuntimeSqliteStore default", async () => {
    const rootDir = await createRepository();
    const store = openRuntimeSqliteStore({ rootDir });
    try {
      expect(store.changedFileGitSnapshotReader).toBe(
        esGitRuntimeChangedFileGitSnapshotReader,
      );
    } finally {
      store.close();
    }
  });

  it("uses an injected changed-file snapshot reader instead of the CLI default", async () => {
    const rootDir = await createRepository();
    const injectedReader: RuntimeChangedFileGitSnapshotReader = {
      async readSnapshot() {
        return {};
      },
    };
    const store = openRuntimeSqliteStore({
      rootDir,
      changedFileGitSnapshotReader: injectedReader,
    });
    try {
      expect(store.changedFileGitSnapshotReader).toBe(injectedReader);
    } finally {
      store.close();
    }
  });
});
