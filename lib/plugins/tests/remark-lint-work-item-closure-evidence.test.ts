import { describe, expect, it } from "vitest";
import closureEvidence from "../remark-lint-work-item-closure-evidence";
import { createProcessor, run as runUtil } from "./utils";

const run = async (md: string, opts?: any, filePath?: string) =>
  runUtil(md, createProcessor(closureEvidence, opts), filePath);

describe("remark-lint-work-item-closure-evidence", () => {
  it("passes for a completed work item with closure evidence", async () => {
    const md = `---
type: work-item
status: completed
status_reason: completed
completed_date: '2026-05-13'
---

## Closure

- 2026-05-13: Closed as completed with evidence in backlog/audit/auditing-backlog-report.json.
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages).toHaveLength(0);
  });

  it("accepts non-audit evidence references in closure note", async () => {
    const md = `---
type: work-item
status: completed
status_reason: completed
completed_date: '2026-05-13'
---

## Closure

- 2026-05-13: Closed as completed with evidence in PR #29 (merge commit e8606de)
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages).toHaveLength(0);
  });

  it("reports missing completed-item evidence metadata", async () => {
    const md = `---
type: work-item
status: completed
---

No closure evidence yet.
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages.map((message) => message.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing status_reason"),
        expect.stringContaining("missing completed_date"),
        expect.stringContaining("missing a closure note with evidence"),
      ]),
    );
  });

  it("skips non-terminal work items", async () => {
    const md = `---
type: work-item
status: running
---
`;
    const result = await run(md, undefined, "/repo/backlog/228.test-story.md");
    expect(result.messages).toHaveLength(0);
  });
});
