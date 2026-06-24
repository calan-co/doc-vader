import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  linkWorkItem,
  migrateBacklog,
  ingestEvent,
  finalizeWorkItem,
  transitionWorkItem,
} from "../lib/work-management/index.js";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";
import { GitHubBacklogAutomationProvider } from "../lib/backlog/providers/github.js";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `doc-vader-work-management-${randomUUID()}`,
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function acquireRuntimeClaim(
  rootDir: string,
  taskId: string,
  lockPaths: string[],
): void {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
    const acquisition = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: taskId,
        holder: "agent-a",
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        entropy: randomUUID(),
      },
      { initialLockPaths: lockPaths },
    );
    if (acquisition.outcome !== "acquired") {
      throw new Error(`Expected runtime claim acquisition for ${taskId}.`);
    }
  } finally {
    store.close();
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.sequential("work-management automation", () => {
  it("keeps work-item link mutations idempotent", async () => {
    const rootDir = await createTempRepo();
    const filePath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-sample.md",
    );
    await writeMarkdown(
      filePath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: prioritized
priority: medium
estimated: 1
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Goal

- Ship sample work.
`,
    );

    await linkWorkItem({
      rootDir,
      id: "work-item:sample",
      kind: "reference",
      value: "work-item-sample.md",
    });
    await linkWorkItem({
      rootDir,
      id: "work-item:sample",
      kind: "reference",
      value: "work-item-sample.md",
    });

    const updated = await readFile(filePath, "utf8");
    const matches = updated.match(/\[\[work-item-sample\]\]/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("governs lifecycle when transitioning a work item into readiness", async () => {
    const rootDir = await createTempRepo();
    const filePath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-sample.md",
    );
    await writeMarkdown(
      filePath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: draft
status: draft
status_reason: needs-triage
priority: medium
estimated: 1
---

## Goal

- Ship sample work.
`,
    );

    const result = await transitionWorkItem({
      rootDir,
      id: "work-item:sample",
      status: "ready",
    });

    expect(result.frontmatter.status).toBe("ready");
    expect(result.frontmatter.lifecycle).toBe("active");
    expect(result.frontmatter.status_reason).toBe("auto");

    const updated = await readFile(filePath, "utf8");
    expect(updated).toContain("lifecycle: active");
    expect(updated).toContain("status: ready");
  });

  it("refuses to transition to completed with unchecked completion criteria", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-sample.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: medium
estimated: 1
---

## Tasks

- [x] Implement the first part.
- [ ] Finish the second part.

## Acceptance Criteria

- [x] Verify the user-facing behavior.
`,
    );

    await expect(
      transitionWorkItem({
        rootDir,
        id: "work-item:sample",
        status: "completed",
      }),
    ).rejects.toThrow(
      /unchecked completion criteria:[\s\S]*Tasks: Finish the second part(?![\s\S]*Acceptance Criteria)/i,
    );
  });

  it("refuses to complete a work item with unchecked acceptance criteria", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-sample.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: completed
priority: medium
estimated: 1
actual: 1
links:
  evidence:
    - '[[record-sample]]'
---

## Tasks

- [x] Implement the work.

## Acceptance Criteria

- [ ] Verify the user-facing behavior.
`,
    );

    await expect(
      transitionWorkItem({
        rootDir,
        id: "work-item:sample",
        status: "completed",
        statusReason: "completed",
      }),
    ).rejects.toThrow(/Acceptance Criteria: Verify the user-facing behavior/i);
  });

  it("allows aborted work items to retain unchecked completion criteria", async () => {
    const rootDir = await createTempRepo();
    const filePath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-sample.md",
    );
    await writeMarkdown(
      filePath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: medium
estimated: 1
---

## Tasks

- [x] Implement the first part.
- [ ] Finish the second part.

## Acceptance Criteria

- [ ] Verify the user-facing behavior.
`,
    );

    const result = await transitionWorkItem({
      rootDir,
      id: "work-item:sample",
      status: "aborted",
      statusReason: "not-planned",
    });

    expect(result.frontmatter.status).toBe("aborted");
    expect(result.frontmatter.lifecycle).toBe("active");
    expect(result.frontmatter.status_reason).toBe("not-planned");
    const updated = await readFile(filePath, "utf8");
    expect(updated).toContain("status: aborted");
  });

  it("allows completed when tasks and acceptance criteria are checked", async () => {
    const rootDir = await createTempRepo();
    const filePath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-sample.md",
    );
    await writeMarkdown(
      filePath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: medium
estimated: 1
---

## Tasks

- [x] Implement the work.

## Acceptance Criteria

- [x] Verify the user-facing behavior.
`,
    );

    const result = await transitionWorkItem({
      rootDir,
      id: "work-item:sample",
      status: "completed",
    });

    expect(result.frontmatter.status).toBe("completed");
    await expect(readFile(filePath, "utf8")).resolves.toContain(
      "status: completed",
    );
  });

  it("migrates legacy backlog items into canonical work-items and records", async () => {
    const rootDir = await createTempRepo();
    const legacyBacklog = path.join(rootDir, "backlog");
    const legacyArchive = path.join(rootDir, "backlog", "archive");
    await writeMarkdown(
      path.join(legacyBacklog, "001_sample_task.md"),
      `---
id: wi-001
type: work-item
subtype: task
lifecycle: active
title: "1: Sample task"
status: running
priority: high
estimated: 3
actual: 1
assignee: dev
test_results:
  - timestamp: 2026-04-12T00:00:00Z
    note: Verified the happy path.
links:
  depends_on:
    - '[[002_other_task]]'
  pull_requests:
    - https://example.com/pr/10
---

## Goal

Do the thing.
`,
    );
    await writeMarkdown(
      path.join(legacyArchive, "002_other_task.md"),
      `---
id: wi-002
type: work-item
subtype: task
lifecycle: active
title: "2: Other task"
status: completed
priority: medium
estimated: 2
actual: 2
assignee: ""
commits:
  abc1234: valid migrated commit
  Infinity: should be dropped
completed_date: 2026-04-10
test_results:
  - timestamp: 2026-04-10T00:00:00Z
    note: Legacy verification note.
links:
  pull_requests:
    - https://example.com/pr/2
---

## Goal

Done.
`,
    );

    const result = await migrateBacklog({ rootDir });
    expect(result.migrated).toHaveLength(2);

    const migratedItem = await readFile(
      path.join(rootDir, "backlog", "active", "work-item-001-sample-task.md"),
      "utf8",
    );
    expect(migratedItem).toContain("id: work-item:001-sample-task");
    expect(migratedItem).toContain("[[record-001-sample-task-evidence-1]]");
    expect(migratedItem).toContain("[[work-item-002-other-task]]");

    const migratedArchiveItem = await readFile(
      path.join(rootDir, "backlog", "archive", "work-item-002-other-task.md"),
      "utf8",
    );
    expect(migratedArchiveItem).not.toContain("assignee:");
    expect(migratedArchiveItem).toContain("abc1234: valid migrated commit");
    expect(migratedArchiveItem).not.toContain("Infinity:");

    const migratedRecord = await readFile(
      path.join(
        rootDir,
        "backlog",
        "records",
        "record-001-sample-task-evidence-1.md",
      ),
      "utf8",
    );
    expect(migratedRecord).toContain("type: record");
    expect(migratedRecord).toContain("## Observation");
  });

  it("skips legacy backlog items that collide on the same target basename", async () => {
    const rootDir = await createTempRepo();
    const legacyBacklog = path.join(rootDir, "backlog");

    await writeMarkdown(
      path.join(legacyBacklog, "001_sample_task.md"),
      `---
id: wi-001
title: "1: Sample task"
status: running
priority: high
estimated: 3
---

## Goal

Keep this item.
`,
    );
    await writeMarkdown(
      path.join(legacyBacklog, "001 sample task.md"),
      `---
id: wi-001-duplicate
title: "1: Sample task duplicate"
status: running
priority: medium
estimated: 1
---

## Goal

This collides and should be skipped.
`,
    );

    const underscoredLegacyPath = path.join(
      rootDir,
      "backlog",
      "001_sample_task.md",
    );
    const spacedLegacyPath = path.join(
      rootDir,
      "backlog",
      "001 sample task.md",
    );
    const [underscoredOriginal, spacedOriginal] = await Promise.all([
      readFile(underscoredLegacyPath, "utf8"),
      readFile(spacedLegacyPath, "utf8"),
    ]);

    const result = await migrateBacklog({ rootDir });

    expect(result.migrated).toHaveLength(1);
    expect(result.migrated[0]?.newPath).toContain(
      "work-item-001-sample-task.md",
    );
    const migratedLegacyPath = result.migrated[0]!.legacyPath;
    expect([underscoredLegacyPath, spacedLegacyPath]).toContain(
      migratedLegacyPath,
    );

    const migratedItem = await readFile(
      path.join(rootDir, "backlog", "active", "work-item-001-sample-task.md"),
      "utf8",
    );
    expect(migratedItem).toContain("id: work-item:001-sample-task");
    if (migratedLegacyPath === underscoredLegacyPath) {
      expect(migratedItem).toContain("title: '1: Sample task'");
      expect(migratedItem).toContain("summary: Sample task");
    } else {
      expect(migratedItem).toContain("title: '1: Sample task duplicate'");
      expect(migratedItem).toContain("summary: Sample task duplicate");
    }

    const remainingLegacyPath =
      migratedLegacyPath === underscoredLegacyPath
        ? spacedLegacyPath
        : underscoredLegacyPath;
    const remainingOriginal =
      migratedLegacyPath === underscoredLegacyPath
        ? spacedOriginal
        : underscoredOriginal;
    await expect(readFile(remainingLegacyPath, "utf8")).resolves.toEqual(
      remainingOriginal,
    );
  });

  it("creates and links evidence records from workflow_run events", async () => {
    const rootDir = await createTempRepo();
    const workItemPath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-sample.md",
    );
    await writeMarkdown(
      workItemPath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Goal

- Validate the change.
`,
    );

    const payloadPath = path.join(rootDir, "workflow-run.json");
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          workflow_run: {
            id: 42,
            name: "CI",
            conclusion: "success",
            updated_at: "2026-04-13T12:00:00Z",
            html_url: "https://example.com/runs/42",
            display_title: "CI for work-item:sample",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ingestEvent({
      rootDir,
      provider: "github",
      event: "workflow_run.completed",
      payloadPath,
    });

    expect(
      result.actions.some((action) => action.type === "create-record"),
    ).toBe(true);

    const updatedWorkItem = await readFile(workItemPath, "utf8");
    expect(updatedWorkItem).toContain("evidence:");
    expect(updatedWorkItem).toContain("[[record-sample-ci-42]]");

    const recordFile = await readFile(
      path.join(rootDir, "backlog", "records", "record-sample-ci-42.md"),
      "utf8",
    );
    expect(recordFile).toContain("summary: CI result for work-item:sample");
    expect(recordFile).toContain("pass");
  });

  it("reports workflow_run completion without completing or closing the work item", async () => {
    const rootDir = await createTempRepo();
    const workItemPath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-ready.md",
    );
    await writeMarkdown(
      workItemPath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:ready
title: Ready Item
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Goal

- Keep the work item open.
`,
    );

    const payloadPath = path.join(rootDir, "workflow-run-ready.json");
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          workflow_run: {
            id: 43,
            name: "CI",
            conclusion: "success",
            updated_at: "2026-04-14T12:00:00Z",
            html_url: "https://example.com/runs/43",
            display_title: "CI for work-item:ready",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ingestEvent({
      rootDir,
      provider: "github",
      event: "workflow_run.completed",
      payloadPath,
    });

    expect(
      result.actions.some((action) => action.type === "create-record"),
    ).toBe(true);

    const updatedWorkItem = await readFile(workItemPath, "utf8");
    expect(updatedWorkItem).toContain("status: ready");
    expect(updatedWorkItem).toContain("lifecycle: active");
    expect(updatedWorkItem).not.toContain("status: completed");
  });

  it("links pull requests for deterministic wi-* token matches in pull_request events", async () => {
    const rootDir = await createTempRepo();
    const workItemPath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-wi-60276.md",
    );
    await writeMarkdown(
      workItemPath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60276
title: Deterministic matching sample
summary: Validate pull-request ingestion subject matching.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: high
estimated: 3
actual: 3
---

## Goal

- Validate deterministic matching.
`,
    );

    const payloadPath = path.join(rootDir, "pull-request.json");
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          pull_request: {
            number: 43,
            html_url: "https://github.com/calan-co/doc-vader/pull/43",
            merged: false,
            title: "chore(backlog): reconcile wi-60276 metadata",
            body: "Tracks wi-60276 and related backlog updates.",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ingestEvent({
      rootDir,
      provider: "github",
      event: "pull_request.edited",
      payloadPath,
    });

    expect(result.subjects).toContain("wi-60276");
    expect(
      result.actions.some(
        (action) =>
          action.type === "link" &&
          action.subject === "wi-60276" &&
          action.kind === "pr" &&
          action.value === "https://github.com/calan-co/doc-vader/pull/43",
      ),
    ).toBe(true);

    const updatedWorkItem = await readFile(workItemPath, "utf8");
    expect(updatedWorkItem).toContain("pull_requests:");
    expect(updatedWorkItem).toContain(
      "https://github.com/calan-co/doc-vader/pull/43",
    );
  });

  it("does not match partial wi-* tokens in pull_request events", async () => {
    const rootDir = await createTempRepo();
    const workItemPath = path.join(
      rootDir,
      "backlog",
      "active",
      "work-item-wi-60276.md",
    );
    await writeMarkdown(
      workItemPath,
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: wi-60276
title: Deterministic matching sample
summary: Validate pull-request ingestion subject matching.
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: high
estimated: 3
actual: 3
---

## Goal

- Validate deterministic matching.
`,
    );

    const payloadPath = path.join(rootDir, "pull-request-partial-token.json");
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          pull_request: {
            number: 44,
            html_url: "https://github.com/calan-co/doc-vader/pull/44",
            merged: false,
            title: "chore(backlog): reconcile wi-60276x metadata",
            body: "Tracks wi-60276x and related backlog updates.",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await ingestEvent({
      rootDir,
      provider: "github",
      event: "pull_request.edited",
      payloadPath,
    });

    expect(result.subjects).not.toContain("wi-60276");
    expect(
      result.actions.some(
        (action) =>
          action.type === "link" &&
          action.subject === "wi-60276" &&
          action.kind === "pr" &&
          action.value === "https://github.com/calan-co/doc-vader/pull/44",
      ),
    ).toBe(false);
  });

  it("refuses to finalize a work item without evidence", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-no-evidence.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:no-evidence
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Goal

- Validate the change.
`,
    );

    await expect(
      finalizeWorkItem({ rootDir, id: "work-item:no-evidence" }),
    ).rejects.toThrow(/without .*evidence/i);
  });

  it("refuses to finalize a work item with unchecked completion criteria", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-unchecked.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:unchecked
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - '[[record-sample]]'
---

## Tasks

- [ ] Finish implementation.

## Acceptance Criteria

- [x] Verify the user-facing behavior.
`,
    );

    await expect(
      finalizeWorkItem({ rootDir, id: "work-item:unchecked" }),
    ).rejects.toThrow(/Tasks: Finish implementation/i);
  });

  it("refuses to finalize a work item with an unmerged linked PR when authenticated", async () => {
    const rootDir = await createTempRepo();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        number: 1,
        title: "Open PR",
        state: "open",
        merged: false,
        html_url: "https://github.com/calan-co/doc-vader/pull/1",
      }),
    }) as typeof fetch;

    try {
      await writeMarkdown(
        path.join(rootDir, "backlog", "active", "work-item-unmerged-pr.md"),
        `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:unmerged-pr
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - '[[record-sample]]'
---

## Goal

- Validate the change.
`,
      );

      await expect(
        finalizeWorkItem({
          rootDir,
          id: "work-item:unmerged-pr",
          provider: new GitHubBacklogAutomationProvider("test-token"),
        }),
      ).rejects.toThrow(/not merged/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses to finalize a work item with linked PRs when PR verification is unauthenticated", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(
        rootDir,
        "backlog",
        "active",
        "work-item-unauthenticated-pr.md",
      ),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:unauthenticated-pr
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - '[[record-sample]]'
---

## Goal

- Validate the change.
`,
    );

    await expect(
      finalizeWorkItem({ rootDir, id: "work-item:unauthenticated-pr" }),
    ).rejects.toThrow(/authenticated provider/i);
  });

  it("fails closed when finalizing a work item outside the ready gate", async () => {
    const rootDir = await createTempRepo();
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-sample.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: running
status_reason: implementation
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://example.com/pr/1
  evidence:
    - '[[record-sample]]'
---

## Goal

- Validate the change.
`,
    );

    await expect(
      finalizeWorkItem({ rootDir, id: "work-item:sample" }),
    ).rejects.toThrow(/Expected completed/i);
  });

  it("finalizes a ready work item when runtime locks cover the write paths", async () => {
    const rootDir = await createTempRepo();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        number: 1,
        title: "Merged PR",
        state: "closed",
        merged: true,
        html_url: "https://github.com/calan-co/doc-vader/pull/1",
      }),
    }) as typeof fetch;
    await writeMarkdown(
      path.join(rootDir, "backlog", "active", "work-item-sample.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:sample
title: Sample
summary: Sample summary
type: work-item
subtype: task
lifecycle: active
status: completed
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - '[[record-sample]]'
---

## Goal

- Validate the change.
`,
    );
    acquireRuntimeClaim(rootDir, "work-item:sample", [
      path.join(rootDir, "backlog", "active", "work-item-sample.md"),
      path.join(rootDir, "backlog", "archive", "work-item-sample.md"),
    ]);

    try {
      await expect(
        finalizeWorkItem({
          rootDir,
          id: "work-item:sample",
          provider: new GitHubBacklogAutomationProvider("test-token"),
        }),
      ).resolves.toMatchObject({
        id: "work-item:sample",
      });
      await expect(
        readFile(
          path.join(rootDir, "backlog", "archive", "work-item-sample.md"),
          "utf8",
        ),
      ).resolves.toContain("status: completed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
