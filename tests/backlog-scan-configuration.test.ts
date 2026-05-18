import { describe, it, beforeEach, afterEach, expect } from "vitest";
import * as fsSync from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { scanBacklog } from "../lib/backlog/scan-executor.js";

let testDir = "";

function mkDir(name: string) {
  fsSync.mkdirSync(path.join(testDir, name), { recursive: true });
}

function mkFile(name: string, content: string) {
  fsSync.writeFileSync(path.join(testDir, name), content, "utf8");
}

function mkConsumerConfig(automation: Record<string, unknown> = {}) {
  mkDir(".doc-vader");
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
        automation,
      },
      null,
      2,
    ),
    "utf8",
  );
}

const VALID_ITEM = `---
id: "1"
status: open
lifecycle: active
title: A task
---
# A task
`;

const INVALID_ITEM = `---
status: open
lifecycle: active
title: Missing id
---
# Missing id
`;

describe("resolver order configuration", () => {
  beforeEach(() => {
    testDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-config-"),
    );
    mkDir("backlog");
  });

  afterEach(() => {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  });

  it("default resolver order is used when neither CLI flag nor config specifies it", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    const report = await scanBacklog({ rootDir: testDir });
    expect(report.options.resolverOrder).toEqual([
      "payload_subject_tokens",
      "linked_pull_requests",
    ]);
  });

  it("consumer config automation.subjectResolutionOrder overrides default", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    mkConsumerConfig({
      subjectResolutionOrder: ["linked_pull_requests"],
    });
    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
    });
    expect(report.options.resolverOrder).toEqual(["linked_pull_requests"]);
  });

  it("CLI resolverOrder takes precedence over consumer config", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    mkConsumerConfig({
      subjectResolutionOrder: ["linked_pull_requests"],
    });
    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
      resolverOrder: ["payload_subject_tokens"],
    });
    expect(report.options.resolverOrder).toEqual(["payload_subject_tokens"]);
  });

  it("unknown resolver name in CLI flag throws a clear error", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    await expect(
      scanBacklog({
        rootDir: testDir,
        resolverOrder: ["unknown_resolver" as never],
      }),
    ).rejects.toThrow(/unsupported resolver/i);
  });

  it("missing consumer config file falls back to default resolver order", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    // Point to a non-existent file; should not throw, should fall back to defaults
    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/nonexistent-consumer.json",
    });
    expect(report.options.resolverOrder).toEqual([
      "payload_subject_tokens",
      "linked_pull_requests",
    ]);
  });

  it("empty subjectResolutionOrder in config falls back to default resolver order", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    mkConsumerConfig({ subjectResolutionOrder: [] });
    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
    });
    expect(report.options.resolverOrder).toEqual([
      "payload_subject_tokens",
      "linked_pull_requests",
    ]);
  });
});

describe("strict mode", () => {
  beforeEach(() => {
    testDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-strict-"),
    );
    mkDir("backlog");
  });

  afterEach(() => {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  });

  it("strict: true → exitCode 1 when scan has errors", async () => {
    mkFile("backlog/1.bad.md", INVALID_ITEM);
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(1);
    expect(report.summary.errorCount).toBeGreaterThan(0);
  });

  it("strict: false (default) → exitCode 0 even when scan has errors", async () => {
    mkFile("backlog/1.bad.md", INVALID_ITEM);
    const report = await scanBacklog({ rootDir: testDir, strict: false });
    expect(report.exitCode).toBe(0);
  });

  it("strict: true → exitCode 0 when scan has no errors", async () => {
    mkFile("backlog/1.task.md", VALID_ITEM);
    const report = await scanBacklog({ rootDir: testDir, strict: true });
    expect(report.exitCode).toBe(0);
  });
});

describe("configurable matching and candidate rules", () => {
  beforeEach(() => {
    testDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), "doc-vader-scan-config-rules-"),
    );
    mkDir("backlog");
  });

  afterEach(() => {
    fsSync.rmSync(testDir, { recursive: true, force: true });
    testDir = "";
  });

  it("uses automation.workItemMatchPatterns for payload subject extraction", async () => {
    mkConsumerConfig({
      workItemMatchPatterns: ["wi-"],
      subjectResolutionOrder: ["payload_subject_tokens"],
    });
    mkFile(
      "backlog/1.wi-token.md",
      `---\nid: wi-1\nstatus: ready\nlifecycle: active\n---\nTracks wi-228 token.\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
    });

    expect(report.items[0]?.subjectResolution?.subjects).toContain("wi-228");
  });

  it("uses automation.pullRequestPath for linked PR resolution", async () => {
    mkConsumerConfig({
      pullRequestPath: "links.prs",
      subjectResolutionOrder: ["linked_pull_requests"],
    });
    mkFile(
      "backlog/2.custom-pr-path.md",
      `---\nid: work-item:2\nstatus: ready\nlifecycle: active\nlinks:\n  prs:\n    - https://github.com/calan-co/doc-vader/pull/2\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
    });

    expect(report.items[0]?.subjectResolution?.subjects).toEqual([
      "work-item:2",
    ]);
  });

  it("uses automation.requiredCandidateFields qualifying values", async () => {
    mkConsumerConfig({
      validateArchiveCandidates: true,
      requiredCandidateFields: [
        "actual",
        { field: "status", values: ["closed"] },
      ],
    });
    mkFile(
      "backlog/3.required-values.md",
      `---\nid: work-item:3\ntype: work-item\nstatus: ready-for-review\nlifecycle: active\nactual: 2\nlinks:\n  pull_requests:\n    - https://github.com/calan-co/doc-vader/pull/3\n  evidence:\n    - '[[record-20260101-000000-3]]'\n---\n`,
    );

    const report = await scanBacklog({
      rootDir: testDir,
      consumerConfig: ".doc-vader/backlog-consumer.json",
    });

    const candidate = report.items.find((item) => item.id === "work-item:3");
    expect(candidate?.candidateValidation?.eligible).toBe(false);
    expect(
      candidate?.candidateValidation?.discrepancies.some((entry) =>
        entry.includes("must be one of: closed"),
      ),
    ).toBe(true);
  });
});
