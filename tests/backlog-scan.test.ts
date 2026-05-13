import { describe, it, beforeEach, afterEach, expect } from "vitest";
import * as fsSync from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { scanBacklog } from "../lib/backlog/scan-executor.js";
import {
  formatScanReportText,
  formatScanReportJson,
} from "../lib/backlog/scan-reporter.js";
import { evaluateConditions } from "../lib/backlog/scan-conditions.js";

let testDir = "";

function mkFile(name: string, content: string) {
  fsSync.writeFileSync(path.join(testDir, name), content, "utf8");
}

function mkConsumerConfig() {
  fsSync.mkdirSync(path.join(testDir, ".doc-vader"), { recursive: true });
  fsSync.writeFileSync(
    path.join(testDir, ".doc-vader", "backlog-consumer.json"),
    JSON.stringify(
      {
        roots: {
          backlog: "backlog",
          active: "backlog",
          archive: "backlog/archive",
          records: "backlog/records",
          audit: "backlog/audit",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
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
      `---\nid: "999"\nstatus: closed\n---\n`,
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
      `---\nid: "999"\nstatus: closed\n---\n`,
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

    const linkedRecordMatch = workItemFile.match(/\[\[(record-\d{8}-\d{6}-009)\]\]/);
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
    const evidenceMatches = workItemFile.match(
      /\[\[record-\d{8}-\d{6}-010\]\]/g,
    ) ?? [];
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
    fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
    const report = await scanBacklog({ rootDir });
    const text = formatScanReportText(report);
    expect(text).toMatch(/Backlog Scan Report/);
    expect(text).toMatch(/Summary:/);
    fsSync.rmSync(rootDir, { recursive: true, force: true });
  });

  it("formatScanReportJson returns valid JSON", async () => {
    const rootDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-report-"),
    );
    fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
    const report = await scanBacklog({ rootDir });
    const json = formatScanReportJson(report);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("scanId");
    expect(parsed).toHaveProperty("summary");
    fsSync.rmSync(rootDir, { recursive: true, force: true });
  });
});
