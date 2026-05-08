import { describe, it, beforeEach, afterEach, expect } from "vitest";
import * as fsSync from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { scanBacklog } from "../lib/backlog/scan-executor.js";
import { formatScanReportText, formatScanReportJson } from "../lib/backlog/scan-reporter.js";
import { evaluateConditions } from "../lib/backlog/scan-conditions.js";

let testDir = "";

function mkFile(name: string, content: string) {
  fsSync.writeFileSync(path.join(testDir, name), content, "utf8");
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
    expect(conditions.find((c) => c.code === "has_links_block")?.value).toBe(true);
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
    expect(report.items[0]?.errors.map((e) => e.code)).toContain("missing_status");
  });

  it("strict mode + errors → exitCode 1", async () => {
    mkFile("backlog/3.bad.md", `---\ntitle: No id\n---\n`);
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(1);
  });

  it("strict mode + no errors → exitCode 0", async () => {
    mkFile(
      "backlog/4.good.md",
      `---\nid: "4"\nstatus: open\n---\n`,
    );
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(0);
  });

  it("files in audit/ subdir are skipped", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "audit"), { recursive: true });
    mkFile("backlog/audit/skipped.md", `---\ntitle: Should be skipped\n---\n`);
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(0);
  });

  it("archive subdir is skipped by default", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "archive"), { recursive: true });
    mkFile("backlog/archive/archived.md", `---\nid: "999"\nstatus: closed\n---\n`);
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.summary.totalFiles).toBe(0);
  });

  it("archive subdir is included when includeArchive=true", async () => {
    fsSync.mkdirSync(path.join(testDir, "backlog", "archive"), { recursive: true });
    mkFile("backlog/archive/archived.md", `---\nid: "999"\nstatus: closed\n---\n`);
    const report = await scanBacklog({ rootDir: testDir, includeArchive: true });
    expect(report.summary.totalFiles).toBe(1);
  });
});

describe("scan reporters", () => {
  it("formatScanReportText includes summary line", async () => {
    const rootDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "doc-vader-scan-report-"));
    fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
    const report = await scanBacklog({ rootDir });
    const text = formatScanReportText(report);
    expect(text).toMatch(/Backlog Scan Report/);
    expect(text).toMatch(/Summary:/);
    fsSync.rmSync(rootDir, { recursive: true, force: true });
  });

  it("formatScanReportJson returns valid JSON", async () => {
    const rootDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "doc-vader-scan-report-"));
    fsSync.mkdirSync(path.join(rootDir, "backlog"), { recursive: true });
    const report = await scanBacklog({ rootDir });
    const json = formatScanReportJson(report);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("scanId");
    expect(parsed).toHaveProperty("summary");
    fsSync.rmSync(rootDir, { recursive: true, force: true });
  });
});
