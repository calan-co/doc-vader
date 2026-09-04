import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateFrontmatter } from "../lib/work-management/frontmatter-lint.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("work-item structure base-schema references", () => {
  it("validates a minimal work item through the registered work-management schemas", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "doc-vader-work-item-schema-ref-"),
    );
    roots.push(rootDir);
    const backlogDir = path.join(rootDir, "backlog");
    await mkdir(backlogDir, { recursive: true });
    await writeFile(
      path.join(backlogDir, "item.md"),
      `---
$schema: schemas/work-management/frontmatter/work-item.json
id: work-item:schema-ref
title: Schema reference validation
summary: Verify registered schema references.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 1
---

## Goal

Validate the work item.
`,
    );

    expect(await validateFrontmatter(["item.md"], { rootDir })).toBe(true);
  });

  it("validates a minimal work item through the finalized frontmatter schema", async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "doc-vader-finalized-work-item-schema-ref-"),
    );
    roots.push(rootDir);
    const backlogDir = path.join(rootDir, "backlog");
    await mkdir(backlogDir, { recursive: true });
    await writeFile(
      path.join(backlogDir, "item.md"),
      `---
$schema: schemas/frontmatter/by-type/work-item/1.0.0.json
id: wi-60442
title: Finalized schema reference validation
summary: Verify the finalized schema resolves in runtime validation.
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
priority: medium
estimated: 1
---

## Goal

Validate the finalized work-item schema.
`,
    );

    expect(await validateFrontmatter(["item.md"], { rootDir })).toBe(true);
  });
});
