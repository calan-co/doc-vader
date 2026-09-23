import { describe, expect, it } from "vitest";
import { validatePullRequestWorkItems } from "../lib/work/merge-gate.js";

const completedWorkItem = `---
id: wi-60498
type: work-item
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-09-21'
actual: 3
links:
  pull_requests:
    - https://github.com/calan-co/doc-vader/pull/95
  evidence:
    - '[[record-20260921-195524-60498]]'
---

## Tasks

- [x] Implement the change.

## Acceptance Criteria

- [x] The implementation is validated.
`;

describe("validatePullRequestWorkItems", () => {
  it("rejects implementation changes without a linked Work item", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [],
    });

    expect(result.errors).toContain(
      "implementation pull requests require exactly one Work item linked through links.pull_requests.",
    );
  });

  it("rejects the missed-ready-state path even when the Work item is linked", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("status: completed", "status: ready")
            .replace("- [x] Implement the change.", "- [ ] Implement the change."),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: status must be 'completed' before its pull request can merge.",
    );
    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: section '## Tasks' has 1 unchecked checklist item(s).",
    );
  });

  it("accepts a fully completed linked Work item", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts", "tests/dv-init.test.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem,
        },
      ],
    });

    expect(result.errors).toEqual([]);
  });

  it("rejects ambiguous associations", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        { filePath: "backlog/60498.md", content: completedWorkItem },
        {
          filePath: "backlog/60500.md",
          content: completedWorkItem.replace(/60498/g, "60500"),
        },
      ],
    });

    expect(result.errors).toContain(
      "implementation pull requests must link exactly one Work item; found 2.",
    );
  });

  it("allows documentation-only pull requests without a Work item", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["docs/reference/work-management.md", "README.md"],
      workItems: [],
    });

    expect(result.errors).toEqual([]);
  });

  it("does not exempt implementation files that share an exempt filename prefix", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["README.md.ts"],
      workItems: [],
    });

    expect(result.errors).toContain(
      "implementation pull requests require exactly one Work item linked through links.pull_requests.",
    );
  });

  it("rejects negative actual effort", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace("actual: 3", "actual: -1"),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require numeric actual effort.",
    );
  });

  it("requires non-empty evidence and a real completed date", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("completed_date: '2026-09-21'", "completed_date: '2026-99-99'")
            .replace("'[[record-20260921-195524-60498]]'", "''"),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require a valid completed_date in YYYY-MM-DD form.",
    );
    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require links.evidence.",
    );
  });

  it("accepts ordered checked checklist items", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("- [x] Implement the change.", "1. [x] Implement the change.")
            .replace("- [x] The implementation is validated.", "1. [X] The implementation is validated."),
        },
      ],
    });

    expect(result.errors).toEqual([]);
  });

  it("rejects ordered unchecked checklist items", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace("- [x] Implement the change.", "1. [ ] Implement the change."),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: section '## Tasks' has 1 unchecked checklist item(s).",
    );
  });

  it("does not count ordered markers without a space", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("- [x] Implement the change.", "1.[x] Implement the change.")
            .replace("- [x] The implementation is validated.", "1.[x] The implementation is validated."),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: section '## Tasks' has no checklist items.",
    );
  });

  it("rejects duplicate checklist sections", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: `${completedWorkItem}\n## Tasks\n\n- [ ] Hide unfinished work.\n`,
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: duplicate section '## Tasks'.",
    );
  });

  it("ignores checklist examples inside fenced code", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("## Tasks", "```md\n## Tasks\n\n- [x] Example.\n```\n\n## Tasks")
            .replace("- [x] Implement the change.", "- [ ] Implement the change."),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: section '## Tasks' has 1 unchecked checklist item(s).",
    );
  });

  it("rejects non-link evidence", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace("'[[record-20260921-195524-60498]]'", "not-a-link"),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require links.evidence.",
    );
  });

  it("rejects a malformed pull-request association", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace(
            `    - https://github.com/calan-co/doc-vader/pull/95`,
            `    - 123\n    - https://github.com/calan-co/doc-vader/pull/95`,
          ),
        },
      ],
    });

    expect(result.errors).toContain(
      "implementation pull requests require exactly one Work item linked through links.pull_requests.",
    );
  });

  it("rejects non-YAML front matter before parsing", () => {
    expect(() =>
      validatePullRequestWorkItems({
        pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
        changedPaths: ["lib/init/command.ts"],
        workItems: [
          {
            filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
            content: completedWorkItem.replace("---\n", "---js\n"),
          },
        ],
      }),
    ).toThrow("only YAML front matter is allowed");
  });
});
