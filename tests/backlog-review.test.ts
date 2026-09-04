import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BACKLOG_REVIEW_PROFILE_ID,
  backlogReviewProfile,
  backlogReviewRegistry,
  formatBacklogReviewReportJson,
  runBacklogReview,
} from "../lib/backlog/review.js";
import { snapshotReviewProfile } from "../lib/evaluation/profile.js";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "cli", "doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;

function runCli(cwd: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, cliPath, ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: process.env.TMPDIR ?? "/tmp" },
    },
  );
}

async function mkTmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-backlog-review-"));
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.mkdir(path.join(root, "backlog", "archive"), { recursive: true });
  return root;
}

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), content, "utf8");
}

async function snapshotFiles(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      result.set(relativePath, await fs.readFile(fullPath, "utf8"));
    }
  }
  await walk(root);
  return result;
}

function insertRuntimeBlockedExecution(root: string, taskId: string): void {
  const store = openRuntimeSqliteStore({ rootDir: root });
  try {
    const result = store.insertExecutionLogEntry({
      schema_version: RUNTIME_SCHEMA_VERSION,
      claim_token: `claim-${randomUUID()}`,
      target_type: "task",
      target_id: taskId,
      state: "halted",
      reason: "blocked",
      created_at: "2026-06-23T12:00:00.000Z",
      detail: {
        code: "x-runtime-task-blocked",
        message: "Blocked by runtime execution.",
      },
    });
    expect(result.claim_token).toBeDefined();
  } finally {
    store.close();
  }
}

describe("backlog review profile", () => {
  it("registers the composed backlog review profile against the shared registry", () => {
    expect(backlogReviewRegistry.get(BACKLOG_REVIEW_PROFILE_ID)).toBe(backlogReviewProfile);
    expect(backlogReviewProfile.checks.map((check) => check.id)).toEqual([
      "backlog.lifecycle",
      "backlog.classification",
      "backlog.dependencies",
      "backlog.evidence",
      "backlog.runtime",
    ]);
    expect(snapshotReviewProfile(backlogReviewProfile).summaryRuleKeys).toEqual([
      "lifecycleFindingCount",
      "classificationFindingCount",
      "dependencyFindingCount",
      "evidenceFindingCount",
      "runtimeFindingCount",
    ]);
  });

  it("produces deterministic grouped JSON and does not mutate files", async () => {
    const root = await mkTmpRoot();
    try {
      await writeFile(
        root,
        "backlog/200-ready.md",
        `---
id: wi-200
title: Ready
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-209]]'
---
`,
      );
      await writeFile(
        root,
        "backlog/201-hitl.md",
        `---
id: wi-201
title: HITL
type: work-item
lifecycle: active
status: ready
tags:
  - afk
  - hitl
---
`,
      );
      await writeFile(
        root,
        "backlog/202-dependency-blocked.md",
        `---
id: wi-202
title: Dependency blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-999]]'
---
`,
      );
      await writeFile(
        root,
        "backlog/203-dependency.md",
        `---
id: wi-203
title: Dependency
type: work-item
lifecycle: active
status: ready
tags:
  - afk
---
`,
      );
      await writeFile(
        root,
        "backlog/204-missing-classification.md",
        `---
id: wi-204
title: Missing classification
type: work-item
lifecycle: active
status: ready
tags:
  - sandcastle
---
`,
      );
      await writeFile(
        root,
        "backlog/205-invalid.md",
        `---
id: wi-205
title: Invalid
type: work-item
lifecycle: active
tags:
  - afk
---
`,
      );
      await writeFile(
        root,
        "backlog/206-closed.md",
        `---
id: wi-206
title: Closed
type: work-item
lifecycle: inactive
status: closed
tags:
  - afk
status_reason: completed
completed_date: 2026-06-20
links:
  evidence:
    - '[[record-20260620-wi-206]]'
---
`,
      );
      await writeFile(
        root,
        "backlog/212-dependency-blocked.md",
        `---
id: wi-212
title: Dependency blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk
links:
  depends_on:
    - '[[wi-203]]'
---
`,
      );
      await writeFile(
        root,
        "backlog/209-closed-dependency.md",
        `---
id: wi-209
title: Closed dependency
type: work-item
lifecycle: inactive
status: closed
tags:
  - afk
status_reason: completed
completed_date: 2026-06-20
links:
  evidence:
    - '[[record-20260620-wi-209]]'
---
`,
      );
      await writeFile(
        root,
        "backlog/archive/208-archived.md",
        `---
id: wi-208
title: Archived
type: work-item
lifecycle: archived
status: ready
tags:
  - afk
---
`,
      );
      await writeFile(
        root,
        "backlog/211-runtime-blocked.md",
        `---
id: wi-211
title: Runtime blocked
type: work-item
lifecycle: active
status: ready
tags:
  - afk
---
`,
      );

      insertRuntimeBlockedExecution(root, "wi-211");

      const before = await snapshotFiles(root);
      const first = await runBacklogReview({ rootDir: root });
      const afterFirst = await snapshotFiles(root);
      const second = await runBacklogReview({ rootDir: root });
      const afterSecond = await snapshotFiles(root);
      const cliJson = JSON.parse(
        runCli(root, ["backlog", "review", "--dir", "backlog", "--json"]),
      ) as typeof first;

      expect(afterFirst).toEqual(before);
      expect(afterSecond).toEqual(before);
      expect(JSON.parse(formatBacklogReviewReportJson(first))).toEqual(
        JSON.parse(formatBacklogReviewReportJson(second)),
      );
      expect(cliJson).toEqual(JSON.parse(formatBacklogReviewReportJson(first)));
      expect(first.summary.candidateIds).toEqual(["wi-200", "wi-203", "wi-204"]);
      expect(first.summary.excludedIds).toEqual([
        "wi-201",
        "wi-202",
        "wi-205",
        "wi-206",
        "wi-208",
        "wi-209",
        "wi-211",
        "wi-212",
      ]);
      expect(first.summary.hitlIds).toEqual(["wi-201"]);
      expect(first.summary.dependencyBlockedIds).toEqual(["wi-212"]);
      expect(first.summary.dependencyStateUnknownIds).toEqual(["wi-202"]);
      expect(first.summary.missingClassificationIds).toEqual([]);
      expect(first.summary.invalidIds).toEqual(["wi-205"]);
      expect(first.summary.closedIds).toEqual(["wi-206", "wi-209"]);
      expect(first.summary.archivedIds).toEqual(["wi-208"]);
      expect(first.summary.runtimeBlockedIds).toEqual(["wi-211"]);
      expect(first.findings.some((finding) => finding.reasonCode === "execution_not_ready")).toBe(true);

      const hitlSubject = first.subjects.find((entry) => entry.subject.id === "wi-201");
      expect(hitlSubject?.findingsByCheck.map((entry) => entry.checkId)).toContain(
        "backlog.classification",
      );
      expect(hitlSubject?.findingsByBlocking.blocking.length).toBeGreaterThan(0);
      expect(hitlSubject?.findingsBySeverity.warn.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
