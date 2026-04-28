import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import {
  linkWorkItem,
  migrateBacklog,
  ingestEvent,
  finalizeWorkItem,
} from "../lib/work-management/index.js";

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "doc-vader-work-management-"));
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("work-management automation", () => {
  it("keeps work-item link mutations idempotent", async () => {
    const rootDir = await createTempRepo();
    const filePath = path.join(rootDir, "backlog", "active", "work-item-sample.md");
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
    - https://example.com/pr/1
---

## Goal

- Ship sample work.
`
    );

    await linkWorkItem({ rootDir, id: "work-item:sample", kind: "reference", value: "work-item-sample.md" });
    await linkWorkItem({ rootDir, id: "work-item:sample", kind: "reference", value: "work-item-sample.md" });

    const updated = await readFile(filePath, "utf8");
    const matches = updated.match(/\[\[work-item-sample\]\]/g) ?? [];
    expect(matches).toHaveLength(1);
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
status: in-progress
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
`
    );
    await writeMarkdown(
      path.join(legacyArchive, "002_other_task.md"),
      `---
id: wi-002
type: work-item
subtype: task
lifecycle: active
title: "2: Other task"
status: closed
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
`
    );

    const result = await migrateBacklog({ rootDir });
    expect(result.migrated).toHaveLength(2);

    const migratedItem = await readFile(
      path.join(rootDir, "backlog", "active", "work-item-001-sample-task.md"),
      "utf8"
    );
    expect(migratedItem).toContain("id: work-item:001-sample-task");
    expect(migratedItem).toContain("[[record-001-sample-task-evidence-1]]");
    expect(migratedItem).toContain("[[work-item-002-other-task]]");

    const migratedArchiveItem = await readFile(
      path.join(rootDir, "backlog", "archive", "work-item-002-other-task.md"),
      "utf8"
    );
    expect(migratedArchiveItem).not.toContain("assignee:");
    expect(migratedArchiveItem).toContain("abc1234: valid migrated commit");
    expect(migratedArchiveItem).not.toContain("Infinity:");

    const migratedRecord = await readFile(
      path.join(rootDir, "backlog", "records", "record-001-sample-task-evidence-1.md"),
      "utf8"
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
status: in-progress
priority: high
estimated: 3
---

## Goal

Keep this item.
`
    );
    await writeMarkdown(
      path.join(legacyBacklog, "001 sample task.md"),
      `---
id: wi-001-duplicate
title: "1: Sample task duplicate"
status: in-progress
priority: medium
estimated: 1
---

## Goal

This collides and should be skipped.
`
    );

    const result = await migrateBacklog({ rootDir });

    expect(result.migrated).toHaveLength(1);
    expect(result.migrated[0]?.newPath).toContain("work-item-001-sample-task.md");

    const migratedItem = await readFile(
      path.join(rootDir, "backlog", "active", "work-item-001-sample-task.md"),
      "utf8"
    );
    expect(migratedItem).toContain("id: work-item:001-sample-task");
    expect(migratedItem).toMatch(/title: '1: Sample task( duplicate)?'/);
    expect(migratedItem).toMatch(/summary: Sample task( duplicate)?/);

    const legacyResults = await Promise.allSettled([
      readFile(path.join(rootDir, "backlog", "001_sample_task.md"), "utf8"),
      readFile(path.join(rootDir, "backlog", "001 sample task.md"), "utf8"),
    ]);
    const remainingLegacyItems = legacyResults
      .filter(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);

    expect(remainingLegacyItems).toHaveLength(1);
    expect(remainingLegacyItems[0]).toMatch(/Sample task( duplicate)?/);
  });

  it("creates and links evidence records from workflow_run events", async () => {
    const rootDir = await createTempRepo();
    const workItemPath = path.join(rootDir, "backlog", "active", "work-item-sample.md");
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
status: ready-for-review
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://example.com/pr/1
---

## Goal

- Validate the change.
`
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
        2
      ),
      "utf8"
    );

    const result = await ingestEvent({
      rootDir,
      provider: "github",
      event: "workflow_run.completed",
      payloadPath,
    });

    expect(result.actions.some((action) => action.type === "create-record")).toBe(true);

    const updatedWorkItem = await readFile(workItemPath, "utf8");
    expect(updatedWorkItem).toContain("evidence:");
    expect(updatedWorkItem).toContain("[[record-sample-ci-42]]");

    const recordFile = await readFile(path.join(rootDir, "backlog", "records", "record-sample-ci-42.md"), "utf8");
    expect(recordFile).toContain("summary: CI result for work-item:sample");
    expect(recordFile).toContain("pass");
  });

  it("refuses to finalize a work item without evidence", async () => {
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
status: ready-for-review
status_reason: awaiting-review
priority: medium
estimated: 2
actual: 2
links:
  pull_requests:
    - https://example.com/pr/1
---

## Goal

- Validate the change.
`
    );

    await expect(finalizeWorkItem({ rootDir, id: "work-item:sample" })).rejects.toThrow(/without linked evidence/i);
  });
});
