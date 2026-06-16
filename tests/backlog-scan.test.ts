import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import * as fsSync from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { scanBacklog } from "../lib/backlog/scan-executor.js";
import {
  formatScanReportText,
  formatScanReportJson,
} from "../lib/backlog/scan-reporter.js";
import { evaluateConditions } from "../lib/backlog/scan-conditions.js";
import { writeBacklogConsumerConfig } from "./helpers/backlog-consumer-config.js";

let testDir = "";

function mkFile(name: string, content: string) {
  fsSync.writeFileSync(path.join(testDir, name), content, "utf8");
}

function mkConsumerConfig(automation: Record<string, unknown> = {}) {
  writeBacklogConsumerConfig(testDir, automation);
}

function mockGithubFetch(
  responses: Record<
    number,
    {
      title: string;
      state: "open" | "closed";
      merged: boolean;
      merge_commit_sha?: string;
      html_url: string;
    }
  >,
): () => void {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.GITHUB_TOKEN = "test-token";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [numberText, response] of Object.entries(responses)) {
      if (url.includes(`/pulls/${numberText}`)) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            number: Number(numberText),
            ...response,
          }),
        } as Response;
      }
    }
    throw new Error(`Unexpected fetch request: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  };
}

describe("scan-conditions", () => {
  it("evaluateConditions: full valid frontmatter → no errors", () => {
    const { conditions, errors } = evaluateConditions({
      id: "123",
      status: "open",
      lifecycle: "active",
    });
    expect(errors).toHaveLength(0);
    expect(conditions.find((c) => c.code === "has_id")?.value).toBe(true);
    expect(conditions.find((c) => c.code === "has_status")?.value).toBe(true);
  });

  it("evaluateConditions: missing id → missing_id error", () => {
    const { errors } = evaluateConditions({ status: "open" });
    expect(errors.some((e) => e.code === "missing_id")).toBe(true);
  });

  it("evaluateConditions: missing status → missing_status error", () => {
    const { errors } = evaluateConditions({ id: "1" });
    expect(errors.some((e) => e.code === "missing_status")).toBe(true);
  });

  it("evaluateConditions: has_links_block true with links array", () => {
    const { conditions } = evaluateConditions({
      id: "1",
      status: "open",
      links: ["[[2.other]]"],
    });
    expect(conditions.find((c) => c.code === "has_links_block")?.value).toBe(
      true,
    );
  });

  it("evaluateConditions: Phase A PR/workflow condition taxonomy", () => {
    const { conditions } = evaluateConditions({
      id: "work-item:175",
      status: "completed",
      lifecycle: "active",
      pr_merged: true,
      workflow_succeeded: true,
      links: {
        pull_requests: ["https://github.com/templjs/templ.js/pull/123"],
        evidence: ["[[record-20260513-123000-175]]"],
      },
    });
    expect(conditions.find((c) => c.code === "pr_link_found")?.value).toBe(
      true,
    );
    expect(conditions.find((c) => c.code === "pr_merged")?.value).toBe(true);
    expect(conditions.find((c) => c.code === "workflow_succeeded")?.value).toBe(
      true,
    );
    expect(conditions.find((c) => c.code === "valid_status")?.value).toBe(true);
    expect(conditions.find((c) => c.code === "valid_evidence")?.value).toBe(
      true,
    );
  });

  it("evaluateConditions: valid_evidence true when status != closed and no evidence links", () => {
    const { conditions } = evaluateConditions({
      id: "work-item:200",
      status: "running",
      lifecycle: "active",
      links: {
        pull_requests: ["https://github.com/example/repo/pull/1"],
      },
    });
    expect(conditions.find((c) => c.code === "valid_evidence")?.value).toBe(
      true,
    );
  });
});

describe("scanBacklog", () => {
  beforeEach(() => {
    testDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "doc-vader-scan-"));
    fsSync.mkdirSync(path.join(testDir, "backlog"), { recursive: true });
  });

  afterEach(() => {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  });

  it("empty backlog dir → report with 0 files", async () => {
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(0);
    expect(report.summary.errorCount).toBe(0);
    expect(report.exitCode).toBe(0);
  });

  it("missing backlog dir → throws clear error", async () => {
    await expect(
      scanBacklog({ rootDir: testDir, backlogDir: "does-not-exist" }),
    ).rejects.toThrow(/Backlog directory not found/);
  });

  it("valid work item → no errors", async () => {
    mkFile(
      "backlog/1.task.md",
      `---\nid: "1"\nstatus: open\nlifecycle: active\ntitle: A task\n---\n# A task\n`,
    );
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(1);
    expect(report.summary.errorCount).toBe(0);
    expect(report.items[0]?.id).toBe("1");
    expect(report.items[0]?.status).toBe("open");
    expect(report.items[0]?.eventMetadata?.id).toBe("1");
    expect(report.items[0]?.eventMetadata?.type).toBe("work_item");
    expect(typeof report.items[0]?.eventMetadata?.timestamp).toBe("string");
    expect(
      report.items[0]?.conditions.find((c) => c.code === "subject_resolved")
        ?.value,
    ).toBe(false);
  });

  it("malformed frontmatter is reported as validation errors (not thrown)", async () => {
    mkFile(
      "backlog/2.malformed.md",
      "---\nid: [unterminated\nstatus: open\n---\n",
    );
    const report = await scanBacklog({ rootDir: testDir });
    const item = report.items.find((i) => i.file.endsWith("2.malformed.md"));
    expect(item?.errors.some((e) => e.code === "missing_id")).toBe(true);
  });

  it("work item missing id and status → 2 errors", async () => {
    mkFile("backlog/2.bad.md", `---\ntitle: No id or status\n---\n`);
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.errorCount).toBe(2);
    expect(report.items[0]?.errors.map((e) => e.code)).toContain("missing_id");
    expect(report.items[0]?.errors.map((e) => e.code)).toContain(
      "missing_status",
    );
  });

  it("strict mode + errors → exitCode 1", async () => {
    mkFile("backlog/3.bad.md", `---\ntitle: No id\n---\n`);
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(1);
  });

  it("strict mode + no errors → exitCode 0", async () => {
    mkFile("backlog/4.good.md", `---\nid: "4"\nstatus: open\n---\n`);
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(0);
  });

  it("files in audit/ subdir are skipped", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "audit"), {
      recursive: true,
    });
    mkFile("backlog/audit/skipped.md", `---\ntitle: Should be skipped\n---\n`);
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(0);
  });

  it("archive subdir is skipped by default", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "archive"), {
      recursive: true,
    });
    mkFile(
      "backlog/archive/archived.md",
      `---\nid: "999"\nstatus: completed\n---\n`,
    );
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(0);
  });

  it("archive subdir is included when includeArchive=true", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "archive"), {
      recursive: true,
    });
    mkFile(
      "backlog/archive/archived.md",
      `---\nid: "999"\nstatus: completed\n---\n`,
    );
    const report = await scanBacklog({
      rootDir: testDir,
      includeArchive: true,
    });
    expect(report.summary.totalFiles).toBe(1);
  });

  it("resolver order can infer subject from linked pull requests", async () => {
    mkFile(
      "backlog/5.linked.md",
      `---\nid: "work-item:005"\nstatus: ready\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/18\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      resolverOrder: ["linked_pull_requests"],
    });

    expect(report.items[0]?.subjectResolution?.strategyUsed).toBe(
      "linked_pull_requests",
    );
    expect(report.items[0]?.subjectResolution?.subjects).toEqual([
      "work-item:005",
    ]);
  });

  it("resolver handles list-of-maps pull_request format in linked_pull_requests", async () => {
    mkFile(
      "backlog/5b.list-format.md",
      `---\nid: "work-item:005b"\nstatus: ready\nlinks:\n  - pull_request: "https://github.com/calan-co/doc-vader/pull/19"\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      resolverOrder: ["linked_pull_requests"],
    });

    const item = report.items.find((i) =>
      i.subjectResolution?.subjects?.includes("work-item:005b"),
    );
    expect(item?.subjectResolution?.strategyUsed).toBe("linked_pull_requests");
    expect(item?.subjectResolution?.subjects).toEqual(["work-item:005b"]);
  });

  it("payload_subject_tokens resolver extracts work-item tokens from content", async () => {
    mkFile(
      "backlog/6.token.md",
      `---\nstatus: ready\n---\nThis closes work-item:token-a and work-item:token-b.\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      resolverOrder: ["payload_subject_tokens"],
    });

    const item = report.items.find((i) =>
      i.subjectResolution?.subjects?.includes("work-item:token-a"),
    );
    expect(item?.subjectResolution?.strategyUsed).toBe(
      "payload_subject_tokens",
    );
    expect(item?.subjectResolution?.subjects).toContain("work-item:token-a");
    expect(item?.subjectResolution?.subjects).toContain("work-item:token-b");
  });

  it("payload_subject_tokens deduplicates repeated tokens", async () => {
    mkFile(
      "backlog/7.dedup.md",
      `---\nstatus: ready\n---\nSee work-item:dedup-x. Also work-item:dedup-x again.\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      resolverOrder: ["payload_subject_tokens"],
    });

    const item = report.items.find((i) =>
      i.subjectResolution?.subjects?.includes("work-item:dedup-x"),
    );
    expect(item?.subjectResolution?.subjects).toEqual(["work-item:dedup-x"]);
  });

  it("default resolver order prefers payload_subject_tokens over linked_pull_requests", async () => {
    mkFile(
      "backlog/8.both.md",
      `---\nid: "work-item:eight"\nstatus: ready\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/19\n---\nThis covers work-item:eight-token.\n`,
    );

    const report = await scanBacklog({ rootDir: testDir });

    const item = report.items.find((i) =>
      i.subjectResolution?.subjects?.includes("work-item:eight-token"),
    );
    expect(item?.subjectResolution?.strategyUsed).toBe(
      "payload_subject_tokens",
    );
  });

  it("invalid resolver names fail fast", async () => {
    await expect(
      scanBacklog({ rootDir: testDir, resolverOrder: ["invalid" as never] }),
    ).rejects.toThrow(/Unsupported resolver/);
  });

  it("generate-evidence creates and links a deterministic evidence record", async () => {
    mkConsumerConfig();
    mkFile(
      "backlog/9.evidence.md",
      `---\nid: "work-item:009"\nstatus: ready\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/20\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      generateEvidence: true,
      consumerConfig: ".doc-vader/backlog-consumer.json",
      resolverOrder: ["linked_pull_requests"],
    });

    expect(report.summary.evidenceRecordsCreated).toBe(1);
    const item = report.items.find((i) => i.id === "work-item:009");
    expect(item?.evidenceGeneration?.created).toBe(true);
    expect(item?.evidenceGeneration?.recordIds[0]).toMatch(
      /^record:\d{8}-\d{6}-009$/,
    );

    const workItemFile = fsSync.readFileSync(
      path.join(testDir, "backlog", "9.evidence.md"),
      "utf8",
    );
    expect(workItemFile).toContain("evidence:");
    expect(workItemFile).toMatch(/\[\[record-\d{8}-\d{6}-009\]\]/);

    const linkedRecordMatch = workItemFile.match(
      /\[\[(record-\d{8}-\d{6}-009)\]\]/,
    );
    expect(linkedRecordMatch).not.toBeNull();
    const linkedRecordBasename = linkedRecordMatch?.[1] ?? "";

    const recordFile = fsSync.readFileSync(
      path.join(testDir, "backlog", "records", `${linkedRecordBasename}.md`),
      "utf8",
    );
    expect(recordFile).toMatch(/id: record:\d{8}-\d{6}-009/);
    expect(recordFile).toContain("subtype: evidence");
  });

  it("generate-evidence is idempotent for repeated scans", async () => {
    mkConsumerConfig();
    mkFile(
      "backlog/10.idempotent.md",
      `---\nid: "work-item:010"\nstatus: ready\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/21\n---\n`,
    );

    await scanBacklog({
      rootDir: testDir,
      generateEvidence: true,
      consumerConfig: ".doc-vader/backlog-consumer.json",
      resolverOrder: ["linked_pull_requests"],
    });
    await scanBacklog({
      rootDir: testDir,
      generateEvidence: true,
      consumerConfig: ".doc-vader/backlog-consumer.json",
      resolverOrder: ["linked_pull_requests"],
    });

    const workItemFile = fsSync.readFileSync(
      path.join(testDir, "backlog", "10.idempotent.md"),
      "utf8",
    );
    const evidenceMatches =
      workItemFile.match(/\[\[record-\d{8}-\d{6}-010\]\]/g) ?? [];
    expect(evidenceMatches).toHaveLength(1);

    const recordFiles = fsSync
      .readdirSync(path.join(testDir, "backlog", "records"))
      .filter((name) => /^record-\d{8}-\d{6}-010\.md$/.test(name));
    expect(recordFiles).toHaveLength(1);
  });

  it("generate-evidence reuses existing evidence links with path/alias/anchor", async () => {
    mkConsumerConfig();
    mkFile(
      "backlog/11.existing-evidence.md",
      `---\nid: "work-item:011"\nstatus: ready\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/22\n  evidence:\n    - "[[records/record-20260513-010101-011.md|Evidence]]"\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      generateEvidence: true,
      consumerConfig: ".doc-vader/backlog-consumer.json",
      resolverOrder: ["linked_pull_requests"],
    });

    const item = report.items.find((i) => i.id === "work-item:011");
    expect(item?.evidenceGeneration?.created).toBe(false);
    expect(item?.evidenceGeneration?.recordIds).toEqual([
      "record:20260513-010101-011",
    ]);
    expect(report.summary.evidenceRecordsCreated).toBe(0);

    const recordsDir = path.join(testDir, "backlog", "records");
    const recordFiles = fsSync.existsSync(recordsDir)
      ? fsSync
          .readdirSync(recordsDir)
          .filter((name) => /^record-\d{8}-\d{6}-011\.md$/.test(name))
      : [];
    expect(recordFiles).toHaveLength(0);
  });
});

describe("scan reporters", () => {
  it("formatScanReportText includes summary line", async () => {
    const rootDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-report-"),
    );
    try {
      fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
      const report = await scanBacklog({ rootDir });
      const text = formatScanReportText(report);
      expect(text).toMatch(/Backlog Scan Report/);
      expect(text).toMatch(/Summary:/);
    } finally {
      fsSync.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("formatScanReportJson returns valid JSON", async () => {
    const rootDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-report-"),
    );
    try {
      fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
      const report = await scanBacklog({ rootDir });
      const json = formatScanReportJson(report);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty("scanId");
      expect(parsed).toHaveProperty("summary");
    } finally {
      fsSync.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("candidate validation and archival", () => {
  beforeEach(() => {
    testDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "doc-vader-scan-"));
    fsSync.mkdirSync(path.join(testDir, "backlog"), { recursive: true });
  });

  afterEach(() => {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  });

  it(
    "validate-archive-candidates archives eligible completed items",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({ validateArchiveCandidates: true });
      const restoreGithub = mockGithubFetch({
        12: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/12",
        },
      });

      try {
        mkFile(
          "backlog/12.archive-ready.md",
          `---
id: "work-item:012"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Archive candidate
actual: 8
completed_date: "2026-01-01"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/12"
  evidence:
    - "[[record-20260101-000000-012]]"
---
# Work item

## Closure Notes
- 2026-01-01: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
        });

        expect(report.summary.candidateItemsEvaluated).toBe(1);
        expect(report.summary.candidatesArchived).toBe(1);
        expect(report.summary.candidateDiscrepancies).toBe(0);
        const item = report.items.find((entry) => entry.id === "work-item:012");
        expect(item?.candidateValidation?.eligible).toBe(true);

        const archived = path.join(
          testDir,
          "backlog",
          "archive",
          "12.archive-ready.md",
        );
        expect(fsSync.existsSync(archived)).toBe(true);
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "validate-archive-candidates blocks finalization when any linked PR is unmerged",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({ validateArchiveCandidates: true });
      const restoreGithub = mockGithubFetch({
        12: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/12",
        },
        13: {
          title: "Open PR",
          state: "open",
          merged: false,
          html_url: "https://github.com/calan-co/doc-vader/pull/13",
        },
      });

      try {
        mkFile(
          "backlog/12.partially-merged.md",
          `---
id: "work-item:012"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Partially merged candidate
actual: 8
completed_date: "2026-01-01"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/12"
    - "https://github.com/calan-co/doc-vader/pull/13"
  evidence:
    - "[[record-20260101-000000-012]]"
---
# Work item

## Closure Notes
- 2026-01-01: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
        });

        const item = report.items.find((entry) => entry.id === "work-item:012");
        expect(item?.candidateValidation?.eligible).toBe(false);
        expect(item?.candidateValidation?.discrepancies.join("\n")).toMatch(
          /not merged/i,
        );
        expect(report.summary.candidatesArchived).toBe(0);
        expect(fsSync.existsSync(path.join(testDir, "backlog", "archive", "12.partially-merged.md"))).toBe(false);
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "validate-archive-candidates fails closed when linked PRs cannot be verified",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({ validateArchiveCandidates: true });

      mkFile(
        "backlog/14.unauthenticated-pr.md",
        `---
id: "work-item:014"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Unauthenticated PR candidate
actual: 5
completed_date: "2026-01-05"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/14"
  evidence:
    - "[[record-20260105-000000-014]]"
---
# Work item

## Closure Notes
- 2026-01-05: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
      );

      const report = await scanBacklog({
        rootDir: testDir,
        consumerConfig: ".doc-vader/backlog-consumer.json",
      });

      const item = report.items.find((entry) => entry.id === "work-item:014");
      expect(item?.candidateValidation?.eligible).toBe(false);
      expect(item?.candidateValidation?.discrepancies.join("\n")).toMatch(
        /authenticated provider/i,
      );
      expect(report.summary.candidatesArchived).toBe(0);
      expect(fsSync.existsSync(path.join(testDir, "backlog", "archive", "14.unauthenticated-pr.md"))).toBe(false);
    },
  );

  it(
    "validate-archive-candidates archives candidates even when other active items reference them",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({ validateArchiveCandidates: true });
      const restoreGithub = mockGithubFetch({
        15: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/15",
        },
      });
      try {
        mkFile(
          "backlog/15.referenced-ready.md",
          `---
id: "work-item:015"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Referenced candidate
actual: 3
completed_date: "2026-01-02"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/15"
  evidence:
    - "[[record-20260102-000000-015]]"
---
# Work item

## Closure Notes
- 2026-01-02: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
        );
        mkFile(
          "backlog/16.depends-on-15.md",
          `---
id: "work-item:016"
type: work-item
status: running
lifecycle: active
title: Dependency
links:
  depends_on:
    - "[[15.referenced-ready]]"
---
# Work item
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
        });

        expect(report.summary.candidateItemsEvaluated).toBe(1);
        expect(report.summary.candidatesArchived).toBe(1);
        expect(report.summary.candidateDiscrepancies).toBe(0);

        const item = report.items.find((entry) => entry.id === "work-item:015");
        expect(item?.candidateValidation?.eligible).toBe(true);
        expect(item?.candidateValidation?.discrepancies.length).toBe(0);

        const archived = path.join(
          testDir,
          "backlog",
          "archive",
          "15.referenced-ready.md",
        );
        expect(fsSync.existsSync(archived)).toBe(true);
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "validate-archive-candidates reports discrepancies and updates invalid status from config",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({
        validateArchiveCandidates: true,
        invalidCandidateStatus: "running",
      });
      mkFile(
        "backlog/13.invalid-ready.md",
        `---
id: "work-item:013"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Invalid candidate
---
# Work item
`,
      );

      const report = await scanBacklog({
        rootDir: testDir,
        consumerConfig: ".doc-vader/backlog-consumer.json",
      });

      expect(report.summary.candidateItemsEvaluated).toBe(1);
      expect(report.summary.candidatesArchived).toBe(0);
      expect(report.summary.candidateDiscrepancies).toBeGreaterThan(0);
      expect(report.summary.invalidStatusUpdates).toBe(1);

      const item = report.items.find((entry) => entry.id === "work-item:013");
      expect(item?.candidateValidation?.eligible).toBe(false);
      expect(item?.candidateValidation?.updatedStatus).toBe("running");

      const updatedFile = fsSync.readFileSync(
        path.join(testDir, "backlog", "13.invalid-ready.md"),
        "utf8",
      );
      expect(updatedFile).toContain("status: running");
    },
  );

  it(
    "validate-archive-candidates auto-generates missing evidence for ready candidates",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({ validateArchiveCandidates: true });
      const restoreGithub = mockGithubFetch({
        21: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/21",
        },
      });
      try {
        mkFile(
          "backlog/21.ready-missing-evidence.md",
          `---
id: "work-item:021"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Ready missing evidence
actual: 1
completed_date: "2026-01-03"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/21"
  evidence:
    - "[[record-20260514-140000-021]]"
---
# Work item

## Closure Notes
- 2026-01-03: Closed as completed with evidence in PR #21.
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
          generateEvidence: true,
          resolverOrder: ["payload_subject_tokens"],
        });

        expect(report.summary.candidateItemsEvaluated).toBe(1);
        expect(report.summary.evidenceRecordsCreated).toBe(0);
        expect(report.summary.candidatesArchived).toBe(1);

        const archived = path.join(
          testDir,
          "backlog",
          "archive",
          "21.ready-missing-evidence.md",
        );
        expect(fsSync.existsSync(archived)).toBe(true);

        const archivedContent = fsSync.readFileSync(archived, "utf8");
        expect(archivedContent).toContain("evidence:");
        expect(archivedContent).toContain("[[record-");
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "validate-archive-candidates auto-generates missing evidence for wi-prefixed candidates",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({
        validateArchiveCandidates: true,
        workItemMatchPatterns: ["wi-"],
      });
      const restoreGithub = mockGithubFetch({
        22: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/22",
        },
      });
      try {
        mkFile(
          "backlog/22.wi-ready-missing-evidence.md",
          `---
id: wi-22
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: WI ready missing evidence
actual: 2
completed_date: "2026-01-04"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/22"
---
# Work item

## Closure Notes
- 2026-01-04: Closed as completed with evidence in PR #22.
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
          generateEvidence: true,
        });

        expect(report.summary.candidateItemsEvaluated).toBe(1);
        expect(report.summary.evidenceRecordsCreated).toBe(1);
        expect(report.summary.candidatesArchived).toBe(1);

        const archived = path.join(
          testDir,
          "backlog",
          "archive",
          "22.wi-ready-missing-evidence.md",
        );
        expect(fsSync.existsSync(archived)).toBe(true);

        const archivedContent = fsSync.readFileSync(archived, "utf8");
        expect(archivedContent).toContain("evidence:");
        expect(archivedContent).toContain("[[record-");
        expect(archivedContent).toContain("wi-22");
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "validate-archive-candidates archives candidate even with nested frontmatter wikilink references",
    { timeout: 15000 },
    async () => {
      // Candidate is in the root backlog folder.
      // The referencing file declares dependency via frontmatter `links.depends_on`.
      mkConsumerConfig({ validateArchiveCandidates: true });
      const restoreGithub = mockGithubFetch({
        17: {
          title: "Merged PR",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/calan-co/doc-vader/pull/17",
        },
      });
      try {
        mkFile(
          "backlog/17.nested-ref-candidate.md",
          `---
id: "work-item:017"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: Nested ref candidate
actual: 2
completed_date: "2026-01-03"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/17"
  evidence:
    - "[[record-20260103-000000-017]]"
---
# Work item

## Closure Notes
- 2026-01-03: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
        );

        // A file in a subdirectory references the candidate by basename in frontmatter links.
        fsSync.mkdirSync(path.join(testDir, "backlog", "sprint-10"), {
          recursive: true,
        });
        mkFile(
          "backlog/sprint-10/18.referencing-from-subdir.md",
          `---
id: "work-item:018"
type: work-item
status: running
lifecycle: active
title: Referencing from subdir
links:
  depends_on:
    - "[[17.nested-ref-candidate]]"
---
# Work item
`,
        );

        const report = await scanBacklog({
          rootDir: testDir,
          consumerConfig: ".doc-vader/backlog-consumer.json",
        });

        expect(report.summary.candidateItemsEvaluated).toBe(1);
        expect(report.summary.candidatesArchived).toBe(1);
        expect(report.summary.candidateDiscrepancies).toBe(0);
        const item = report.items.find((entry) => entry.id === "work-item:017");
        expect(item?.candidateValidation?.eligible).toBe(true);
      } finally {
        restoreGithub();
      }
    },
  );

  it(
    "inbound-reference guard does not block archival when same-name file in archive absorbs the wikilink",
    { timeout: 15000 },
    async () => {
      // If an active file links [[X]] and an archive copy of X exists, the
      // resolver picks the archive copy (alphabetically 'archive/...' < 'sprint/..'
      // but also alphabetically the bare filename sorts before archive sub-path,
      // so here we create ONLY an archive copy of the name to force resolution there).
      mkConsumerConfig({ validateArchiveCandidates: true });

      // Candidate has a *different* basename so the wikilink cannot hit it.
      mkFile(
        "backlog/19.no-inbound-candidate.md",
        `---
id: "work-item:019"
type: work-item
status: completed
status_reason: completed
lifecycle: active
title: No inbound candidate
actual: 2
completed_date: "2026-01-04"
links:
  pull_requests:
    - "https://github.com/calan-co/doc-vader/pull/19"
  evidence:
    - "[[record-20260104-000000-019]]"
---
# Work item

## Closure Notes
- 2026-01-04: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`,
      );

      // An archive copy of a *different* file exists.  The active referencing file
      // links to it — this must NOT block archival of our candidate.
      fsSync.mkdirSync(path.join(testDir, "backlog", "archive"), {
        recursive: true,
      });
      mkFile(
        "backlog/archive/other.md",
        `---
id: "work-item:other"
type: work-item
status: completed
lifecycle: archived
title: Other archived
---
`,
      );
      mkFile(
        "backlog/20.references-archived-only.md",
        `---
id: "work-item:020"
type: work-item
status: running
lifecycle: active
title: References archived only
---

See [[other]] for prior context.
`,
      );

      const report = await scanBacklog({
        rootDir: testDir,
        consumerConfig: ".doc-vader/backlog-consumer.json",
      });

      const item = report.items.find((entry) => entry.id === "work-item:019");
      // Candidate has no inbound active references pointing to it — should be
      // blocked only by missing finalization prereqs, not by the reference guard.
      expect(item?.candidateValidation?.discrepancies ?? []).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("Cannot archive while referenced"),
        ]),
      );
    },
  );

  it(
    "invalid-candidate-status override takes precedence over config",
    { timeout: 15000 },
    async () => {
      mkConsumerConfig({
        validateArchiveCandidates: true,
        invalidCandidateStatus: "running",
      });
      mkFile(
        "backlog/14.invalid-override.md",
        `---
id: "work-item:014"
type: work-item
status: completed
lifecycle: active
title: Invalid candidate override
---
# Work item
`,
      );

      const report = await scanBacklog({
        rootDir: testDir,
        consumerConfig: ".doc-vader/backlog-consumer.json",
        invalidCandidateStatus: "ready",
      });

      const item = report.items.find((entry) => entry.id === "work-item:014");
      expect(item?.candidateValidation?.updatedStatus).toBe("ready");
      expect(report.options.invalidCandidateStatus).toBe("ready");
    },
  );
});
