import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findReadyAfkEligibleWorkItems,
  isReadyAfkEligibleWorkItem,
} from "../lib/backlog/backlog.js";

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function withTempBacklogDir(
  testBody: (backlogDir: string) => Promise<void>,
): Promise<void> {
  const tmp = await mkTmpDir("doc-vader-afk-query-");
  try {
    await testBody(path.join(tmp, "backlog"));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

describe("AFK ready eligibility query", () => {
  it("selects only active ready work items tagged afk and not hitl", async () => {
    await withTempBacklogDir(async (backlogDir) => {
      await writeFile(
        path.join(backlogDir, "1.ready-afk.md"),
        `---\nid: wi-1\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\ntags:\n  - afk\n---\n`,
      );
      await writeFile(
        path.join(backlogDir, "2.ready-hitl.md"),
        `---\nid: wi-2\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\ntags:\n  - afk\n  - hitl\n---\n`,
      );
      await writeFile(
        path.join(backlogDir, "archive", "3.archived.md"),
        `---\nid: wi-3\ntype: work-item\nsubtype: task\nlifecycle: archived\nstatus: ready\ntags:\n  - afk\n---\n`,
      );
      await writeFile(
        path.join(backlogDir, "audit", "audit-report.md"),
        `---\nid: wi-audit\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\ntags:\n  - afk\n---\n`,
      );
      await writeFile(
        path.join(backlogDir, "4.ready-other.md"),
        `---\nid: wi-4\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\ntags:\n  - backlog\n---\n`,
      );

      const report = await findReadyAfkEligibleWorkItems(backlogDir);

      expect(report).toHaveLength(1);
      expect(report[0]?.id).toBe("wi-1");
      expect(report[0]?.tags).toEqual(["afk"]);
    });
  });

  it("treats missing or non-matching tags as ineligible", () => {
    expect(
      isReadyAfkEligibleWorkItem({
        id: "wi-1",
        type: "work-item",
        status: "ready",
        lifecycle: "active",
        tags: ["afk"],
      }),
    ).toBe(true);
    expect(
      isReadyAfkEligibleWorkItem({
        id: "wi-2",
        type: "work-item",
        status: "ready",
        lifecycle: "active",
        tags: ["afk", "hitl"],
      }),
    ).toBe(false);
    expect(
      isReadyAfkEligibleWorkItem({
        id: "wi-3",
        type: "work-item",
        status: "ready-for-review",
        lifecycle: "active",
        tags: ["afk"],
      }),
    ).toBe(false);
    expect(
      isReadyAfkEligibleWorkItem({
        id: "wi-4",
        type: "work-item",
        status: "ready",
        lifecycle: "unknown",
        tags: ["afk"],
      }),
    ).toBe(false);
  });
});
