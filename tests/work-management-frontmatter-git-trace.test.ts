import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import {
  createFrontmatterGitReadTrace,
  validateFrontmatter,
} from "../lib/work-management/frontmatter-lint.js";

const roots: string[] = [];
const originalEnvironment = {
  PR_BASE_SHA: process.env.PR_BASE_SHA,
  GITHUB_BASE_SHA: process.env.GITHUB_BASE_SHA,
  GITHUB_BASE_REF: process.env.GITHUB_BASE_REF,
};

afterEach(async () => {
  for (const key of Object.keys(originalEnvironment) as (keyof typeof originalEnvironment)[]) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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

function workItem(status: "ready" | "running" | "completed", options: {
  completedDate?: boolean;
} = {}): string {
  const terminalFields = status === "completed"
    ? `actual: 1
${options.completedDate === false ? "" : "completed_date: '2026-01-01'\n"}`
    : "";
  const terminalEvidence = status === "completed"
    ? "\n- 2026-01-01: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.\n"
    : "";
  return `---
id: wi-123
title: Git trace fixture
summary: Trace immutable Git reads.
type: work-item
subtype: task
lifecycle: active
status: ${status}
status_reason: ${status === "completed" ? "completed" : status === "ready" ? "auto" : "implementation"}
priority: medium
estimated: 1
${terminalFields}links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Tasks

- [x] Exercise immutable Git reads.

## Acceptance Criteria

- [x] Verify the trace contract.
${terminalEvidence}`;
}

async function createRepository(
  backlogRoot = "backlog",
  initialStatus: "running" | "completed" = "completed",
): Promise<{
  rootDir: string;
  baseSha: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-git-trace-"));
  roots.push(rootDir);
  git(rootDir, ["init", "--initial-branch", "main"]);
  git(rootDir, ["config", "user.email", "frontmatter-trace@example.com"]);
  git(rootDir, ["config", "user.name", "Frontmatter Trace"]);
  await fs.mkdir(path.join(rootDir, backlogRoot), { recursive: true });
  await fs.writeFile(path.join(rootDir, backlogRoot, "item.md"), workItem(initialStatus));
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "base"]);
  return { rootDir, baseSha: git(rootDir, ["rev-parse", "HEAD"]) };
}

async function commitChangedWorkItem(rootDir: string, backlogRoot = "backlog"): Promise<void> {
  await fs.writeFile(
    path.join(rootDir, backlogRoot, "item.md"),
    `${workItem("completed")}\nFeature update.\n`,
  );
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-m", "complete work item"]);
}

describe.sequential("work-management immutable frontmatter Git-read trace", () => {
  it("traces configured and default repository-relative roots with an explicit baseline", async () => {
    const defaultFixture = await createRepository();
    await commitChangedWorkItem(defaultFixture.rootDir);
    process.env.PR_BASE_SHA = defaultFixture.baseSha;
    const defaultTrace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: defaultFixture.rootDir, gitTrace: defaultTrace })).toBe(true);
    expect(defaultTrace.selectedLocalRoot).toBe(defaultFixture.rootDir);
    expect(defaultTrace.backlogRoot).toBe("backlog");
    expect(defaultTrace.comparisonRef).toBe(defaultFixture.baseSha);
    expect(defaultTrace.changedSet).toEqual(["backlog/item.md"]);
    expect(defaultTrace.historicalContentReads).toEqual({ "backlog/item.md": "value" });
    expect(defaultTrace.outcomeState).toMatchObject({
      comparisonRef: "resolved",
      changedSet: "value",
      historicalContent: "value",
      terminalDiagnostics: "enforced",
    });
    expect(defaultTrace.directGitSubprocess.invocationCount).toBe(0);
    expect(defaultTrace.directGitSubprocess.durationMs).toBeGreaterThanOrEqual(0);
    expect(defaultTrace.operationOnlyMs).toBeGreaterThanOrEqual(0);

    const configuredFixture = await createRepository("work-items");
    await fs.mkdir(path.join(configuredFixture.rootDir, ".doc-vader"), { recursive: true });
    await fs.writeFile(
      path.join(configuredFixture.rootDir, ".doc-vader", "backlog-consumer.json"),
      JSON.stringify({ roots: { backlog: "work-items" } }),
    );
    await commitChangedWorkItem(configuredFixture.rootDir, "work-items");
    process.env.PR_BASE_SHA = configuredFixture.baseSha;
    const configuredTrace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: configuredFixture.rootDir, gitTrace: configuredTrace })).toBe(true);
    expect(configuredTrace.backlogRoot).toBe("work-items");
    expect(configuredTrace.changedSet).toEqual(["work-items/item.md"]);
    expect(configuredTrace.historicalContentReads).toEqual({ "work-items/item.md": "value" });
  });

  it("resolves GITHUB_BASE_REF and HEAD~1 baselines independently for each lint invocation", async () => {
    const githubBaseFixture = await createRepository();
    await commitChangedWorkItem(githubBaseFixture.rootDir);
    git(githubBaseFixture.rootDir, ["update-ref", "refs/remotes/origin/main", githubBaseFixture.baseSha]);
    delete process.env.PR_BASE_SHA;
    delete process.env.GITHUB_BASE_SHA;
    process.env.GITHUB_BASE_REF = "main";
    const githubBaseTrace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: githubBaseFixture.rootDir, gitTrace: githubBaseTrace })).toBe(true);
    expect(githubBaseTrace.comparisonRef).toBe(githubBaseFixture.baseSha);
    expect(githubBaseTrace.directGitSubprocess.invocationCount).toBe(0);

    const fallbackFixture = await createRepository();
    await commitChangedWorkItem(fallbackFixture.rootDir);
    delete process.env.GITHUB_BASE_REF;
    const fallbackTrace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: fallbackFixture.rootDir, gitTrace: fallbackTrace })).toBe(true);
    expect(fallbackTrace.comparisonRef).toBe(fallbackFixture.baseSha);
    expect(fallbackTrace.directGitSubprocess.invocationCount).toBe(0);
  });

  it("uses the selected linked-worktree root for every immutable read", async () => {
    const fixture = await createRepository();
    const worktreeDir = `${fixture.rootDir}-worktree`;
    roots.push(worktreeDir);
    git(fixture.rootDir, ["worktree", "add", "-b", "feature/frontmatter-trace", worktreeDir]);
    await commitChangedWorkItem(worktreeDir);
    process.env.PR_BASE_SHA = fixture.baseSha;
    const trace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: worktreeDir, gitTrace: trace })).toBe(true);
    expect(trace.selectedLocalRoot).toBe(worktreeDir);
    expect(trace.comparisonRef).toBe(fixture.baseSha);
    expect(trace.changedSet).toEqual(["backlog/item.md"]);
  });

  it("fails open when comparison or historical content is unavailable and excludes untracked files from the changed set", async () => {
    const noHistoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-no-history-"));
    roots.push(noHistoryRoot);
    await fs.mkdir(path.join(noHistoryRoot, "backlog"), { recursive: true });
    await fs.writeFile(path.join(noHistoryRoot, "backlog", "item.md"), workItem("ready"));
    const unavailableTrace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: noHistoryRoot, gitTrace: unavailableTrace })).toBe(true);
    expect(unavailableTrace.outcomeState.comparisonRef).toBe("unavailable");
    expect(unavailableTrace.stages.historicalContentRead.invocationCount).toBe(1);
    expect(unavailableTrace.outcomeState.historicalContent).toBe("unavailable");

    const fixture = await createRepository();
    await fs.writeFile(path.join(fixture.rootDir, "backlog", "new.md"), workItem("completed"));
    process.env.PR_BASE_SHA = fixture.baseSha;
    const trace = createFrontmatterGitReadTrace();

    expect(await validateFrontmatter([], { rootDir: fixture.rootDir, gitTrace: trace })).toBe(true);
    expect(trace.changedSet).toEqual([]);
    expect(trace.historicalContentReads).toEqual({ "backlog/item.md": "value", "backlog/new.md": "unavailable" });
    expect(trace.outcomeState.changedSet).toBe("value");
  });

  it("fails open for an already-terminal item when Git history is unavailable", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-frontmatter-no-history-terminal-"));
    roots.push(rootDir);
    await fs.mkdir(path.join(rootDir, "backlog"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "backlog", "item.md"), workItem("completed", { completedDate: false }));
    const trace = createFrontmatterGitReadTrace();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await validateFrontmatter([], { rootDir, gitTrace: trace })).toBe(true);
    expect(trace.outcomeState.comparisonRef).toBe("unavailable");
    expect(trace.outcomeState.terminalDiagnostics).toBe("not-enforced");
    error.mockRestore();
  });

  it("does not read timing data without a Git trace", async () => {
    const fixture = await createRepository();
    const now = vi.spyOn(performance, "now");

    expect(await validateFrontmatter([], { rootDir: fixture.rootDir })).toBe(true);
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("records terminal diagnostic enforcement while preserving the terminal diagnostic", async () => {
    const fixture = await createRepository("backlog", "running");
    await fs.writeFile(path.join(fixture.rootDir, "backlog", "intermediate.md"), workItem("ready"));
    git(fixture.rootDir, ["add", "."]);
    git(fixture.rootDir, ["commit", "-m", "intermediate"]);
    await fs.writeFile(path.join(fixture.rootDir, "backlog", "item.md"), workItem("completed", { completedDate: false }));
    git(fixture.rootDir, ["add", "."]);
    git(fixture.rootDir, ["commit", "-m", "missing completed date"]);
    delete process.env.PR_BASE_SHA;
    process.env.GITHUB_BASE_SHA = fixture.baseSha;
    const trace = createFrontmatterGitReadTrace();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await validateFrontmatter([], { rootDir: fixture.rootDir, gitTrace: trace })).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("completed_date is missing"));
    expect(trace.comparisonRef).toBe(fixture.baseSha);
    expect(trace.outcomeState.terminalDiagnostics).toBe("enforced");
    error.mockRestore();
  });
});
