import { describe, expect, it } from "vitest";
import archiveReadiness from "../remark-lint-work-item-archive-readiness";
import { createProcessor, run as runUtil } from "./utils";

const run = async (md: string, opts?: any, filePath?: string) =>
  runUtil(md, createProcessor(archiveReadiness, opts), filePath);

describe("remark-lint-work-item-archive-readiness", () => {
  it("passes for a completed work item with archive prerequisites", async () => {
    const md = `---
type: work-item
status: completed
actual: 3
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/1
  evidence:
    - https://github.com/calan-co/doc-vader/pull/1
---

## Notes

Ready for archive validation.
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages).toHaveLength(0);
  });

  it("reports missing pull requests, evidence, and actual", async () => {
    const md = `---
type: work-item
status: completed
---
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages.map((message) => message.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Missing links.pull_requests"),
        expect.stringContaining("Missing links.evidence"),
        expect.stringContaining("Missing numeric actual effort"),
      ]),
    );
  });

  it("applies to completed work items", async () => {
    const md = `---
type: work-item
status: completed
actual: 2
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/2
  evidence:
    - backlog/audit/auditing-backlog-report.json
---

## Closure

- 2026-05-13: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages).toHaveLength(0);
  });

  it("skips archived work items", async () => {
    const md = `---
type: work-item
status: completed
---
`;
    const result = await run(
      md,
      undefined,
      "/repo/backlog/archive/228.test-story.md",
    );
    expect(result.messages).toHaveLength(0);
  });

  it("fails on invalid options", async () => {
    const md = `---
type: work-item
status: completed
---
`;
    const result = await run(
      md,
      { statuses: ["ready"] },
      "/repo/backlog/228.test-story.md",
    );
    expect(result.messages[0].message).toMatch(
      /^Invalid remark-lint-work-item-archive-readiness options/,
    );
  });
});
