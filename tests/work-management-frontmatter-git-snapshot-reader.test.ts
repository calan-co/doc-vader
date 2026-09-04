import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFrontmatterGitSnapshot } from "../lib/work-management/frontmatter-git-snapshot-reader.js";

const roots: string[] = [];
const originalPrBaseSha = process.env.PR_BASE_SHA;
const originalGithubBaseSha = process.env.GITHUB_BASE_SHA;
const originalGithubBaseRef = process.env.GITHUB_BASE_REF;

afterEach(async () => {
  if (originalPrBaseSha === undefined) {
    delete process.env.PR_BASE_SHA;
  } else {
    process.env.PR_BASE_SHA = originalPrBaseSha;
  }
  if (originalGithubBaseSha === undefined) {
    delete process.env.GITHUB_BASE_SHA;
  } else {
    process.env.GITHUB_BASE_SHA = originalGithubBaseSha;
  }
  if (originalGithubBaseRef === undefined) {
    delete process.env.GITHUB_BASE_REF;
  } else {
    process.env.GITHUB_BASE_REF = originalGithubBaseRef;
  }
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function git(rootDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

async function write(rootDir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(rootDir, "backlog", name), content);
}

describe.sequential("frontmatter es-git snapshot reader", () => {
  it("matches git diff --name-only for an explicit arbitrary baseline across tracked states and excludes untracked paths", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-snapshot-"));
    roots.push(rootDir);
    git(rootDir, ["init", "--initial-branch", "main"]);
    git(rootDir, ["config", "user.email", "snapshot@example.com"]);
    git(rootDir, ["config", "user.name", "Snapshot"]);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    await Promise.all([
      write(rootDir, "committed.md", "baseline committed\n"),
      write(rootDir, "staged.md", "baseline staged\n"),
      write(rootDir, "unstaged.md", "baseline unstaged\n"),
      write(rootDir, "staged-then-modified.md", "baseline staged then modified\n"),
      write(rootDir, "deleted.md", "baseline deleted\n"),
      write(rootDir, "renamed.md", "baseline renamed\n"),
      write(rootDir, "unchanged.md", "baseline unchanged\n"),
    ]);
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "baseline"]);
    const baseline = git(rootDir, ["rev-parse", "HEAD"]);

    await write(rootDir, "committed.md", "committed change\n");
    git(rootDir, ["add", "backlog/committed.md"]);
    git(rootDir, ["commit", "-m", "committed change"]);
    await write(rootDir, "staged.md", "staged change\n");
    git(rootDir, ["add", "backlog/staged.md"]);
    await write(rootDir, "unstaged.md", "unstaged change\n");
    await write(rootDir, "staged-then-modified.md", "staged version\n");
    git(rootDir, ["add", "backlog/staged-then-modified.md"]);
    await write(rootDir, "staged-then-modified.md", "unstaged version after staging\n");
    await fs.unlink(path.join(rootDir, "backlog", "deleted.md"));
    git(rootDir, ["rm", "backlog/deleted.md"]);
    git(rootDir, ["mv", "backlog/renamed.md", "backlog/renamed-target.md"]);
    await write(rootDir, "untracked.md", "untracked change\n");

    process.env.PR_BASE_SHA = baseline;
    delete process.env.GITHUB_BASE_REF;
    const candidatePaths = [
      "backlog/committed.md",
      "backlog/staged.md",
      "backlog/unstaged.md",
      "backlog/staged-then-modified.md",
      "backlog/deleted.md",
      "backlog/renamed.md",
      "backlog/renamed-target.md",
      "backlog/unchanged.md",
      "backlog/untracked.md",
    ];
    const snapshot = await readFrontmatterGitSnapshot({
      rootDir,
      backlogRoot: "backlog",
      candidatePaths,
    });
    const expectedChangedPaths = git(rootDir, ["diff", "--name-only", baseline, "--", "backlog"])
      .split("\n")
      .filter(Boolean)
      .sort();

    expect(snapshot.comparisonRef).toBe(baseline);
    expect(snapshot.changedPaths).toEqual(expectedChangedPaths);
    expect(snapshot.changedPaths).not.toContain("backlog/untracked.md");
    expect(snapshot.historicalContents).toMatchObject({
      "backlog/committed.md": "baseline committed\n",
      "backlog/staged.md": "baseline staged\n",
      "backlog/unstaged.md": "baseline unstaged\n",
      "backlog/staged-then-modified.md": "baseline staged then modified\n",
      "backlog/deleted.md": "baseline deleted\n",
      "backlog/renamed.md": "baseline renamed\n",
      "backlog/renamed-target.md": null,
      "backlog/unchanged.md": "baseline unchanged\n",
      "backlog/untracked.md": null,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.changedPaths)).toBe(true);
    expect(Object.isFrozen(snapshot.historicalContents)).toBe(true);
  });

  it("uses GITHUB_BASE_SHA before branch merge-base and HEAD~1", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-github-base-"));
    roots.push(rootDir);
    git(rootDir, ["init", "--initial-branch", "main"]);
    git(rootDir, ["config", "user.email", "snapshot@example.com"]);
    git(rootDir, ["config", "user.name", "Snapshot"]);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    await write(rootDir, "item.md", "baseline item\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "baseline"]);
    const baseline = git(rootDir, ["rev-parse", "HEAD"]);
    await write(rootDir, "intermediate.md", "intermediate\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "intermediate"]);
    await write(rootDir, "item.md", "final item\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "final"]);

    delete process.env.PR_BASE_SHA;
    process.env.GITHUB_BASE_SHA = baseline;
    process.env.GITHUB_BASE_REF = "missing";
    const snapshot = await readFrontmatterGitSnapshot({
      rootDir,
      backlogRoot: "backlog",
      candidatePaths: ["backlog/item.md", "backlog/intermediate.md"],
    });

    expect(snapshot.comparisonRef).toBe(baseline);
    expect(snapshot.changedPaths).toEqual([
      "backlog/intermediate.md",
      "backlog/item.md",
    ]);
  });
});
