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
