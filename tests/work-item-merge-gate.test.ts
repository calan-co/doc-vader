import { describe, expect, it } from "vitest";
import { validatePullRequestWorkItems } from "../lib/work/merge-gate.js";

const completedWorkItem = `---
id: wi-60498
type: work-item
lifecycle: active
status: completed
status_reason: completed
completed_date: '2026-09-21'
estimated: 3
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
      "implementation pull requests require at least one Work item linked through links.pull_requests.",
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

  it("rejects unquoted completed dates", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace("completed_date: '2026-09-21'", "completed_date: 2026-09-21"),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require a valid completed_date in YYYY-MM-DD form.",
    );
  });

  it("accepts multiple fully completed linked Work items", () => {
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

    expect(result.errors).toEqual([]);
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
      "implementation pull requests require at least one Work item linked through links.pull_requests.",
    );
  });

  it("allows a completed linked Work item without effort when no estimate exists", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("estimated: 3\n", "")
            .replace("actual: 3\n", ""),
        },
      ],
    });

    expect(result.errors).toEqual([]);
  });

  it("rejects a malformed estimate instead of bypassing actual effort", () => {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem
            .replace("estimated: 3", "estimated: unknown")
            .replace("actual: 3\n", ""),
        },
      ],
    });

    expect(result.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: estimated effort must be numeric.",
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
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items with an estimate require numeric actual effort.",
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

  it("rejects non-punctuation after wikilink evidence while allowing punctuation", () => {
    const invalidEvidence = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace(
            "'[[record-20260921-195524-60498]]'",
            "'[[record-20260921-195524-60498]]junk'",
          ),
        },
      ],
    });
    expect(invalidEvidence.errors).toContain(
      "backlog/60498-initialize-doc-pack-workspaces.md: completed work items require links.evidence.",
    );

    const punctuatedEvidence = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems: [
        {
          filePath: "backlog/60498-initialize-doc-pack-workspaces.md",
          content: completedWorkItem.replace(
            "'[[record-20260921-195524-60498]]'",
            "'[[record-20260921-195524-60498]].'",
          ),
        },
      ],
    });
    expect(punctuatedEvidence.errors).toEqual([]);
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
      "implementation pull requests require at least one Work item linked through links.pull_requests.",
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


it.each([
  ["incomplete", (s: string) => s.replace("status: completed", "status: running"), "status must be 'completed'"],
  ["unchecked tasks", (s: string) => s.replace("[x] Implement", "[ ] Implement"), "unchecked checklist"],
  ["unchecked criteria", (s: string) => s.replace("[x] The implementation", "[ ] The implementation"), "unchecked checklist"],
  ["missing evidence", (s: string) => s.replace("  evidence:\n    - '[[record-20260921-195524-60498]]'\n", ""), "require links.evidence"],
  ["missing date", (s: string) => s.replace("completed_date: '2026-09-21'\n", ""), "require a valid completed_date"],
  ["missing effort", (s: string) => s.replace("actual: 3\n", ""), "require numeric actual effort"],
])("rejects a multi-item PR with %s in any linked item", (_name, invalidate, error) => {
  const valid = { filePath: "backlog/60498.md", content: completedWorkItem };
  const invalid = { filePath: "backlog/60500.md", content: invalidate(completedWorkItem).replace(/60498/g, "60500") };
  for (const workItems of [[valid, invalid], [invalid, valid]]) {
    const result = validatePullRequestWorkItems({
      pullRequestUrl: "https://github.com/calan-co/doc-vader/pull/95",
      changedPaths: ["lib/init/command.ts"],
      workItems,
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining(`backlog/60500.md:`)]));
    expect(result.errors.some((message) => message.includes(error))).toBe(true);
  }
});
