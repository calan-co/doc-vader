import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildWorkItemProposalBatch,
  createReviewSynthesisCapture,
  formatBacklogReviewSynthesisJson,
  formatBacklogReviewSynthesisText,
  formatWorkItemProposalBatchJson,
  formatWorkItemProposalBatchText,
  validateWorkItemProposalBatch,
} from "../lib/backlog/synthesis.js";

const tempDirs: string[] = [];

async function mkTmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-synthesis-"));
  tempDirs.push(dir);
  return dir;
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      result.set(path.relative(dir, full), await fs.readFile(full, "utf8"));
    }
  }
  await walk(dir);
  return result;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("backlog synthesis capture", () => {
  it("stores synthesis separately from deterministic summaries and renders focused grilling prompts", () => {
    const capture = createReviewSynthesisCapture({
      report: {
        reportId: "backlog-review:wi-60382",
        profileId: "backlog-review",
      },
      subjectRefs: ["work-item:wi-60382"],
      sourceFindingRefs: ["finding:scope-ambiguity"],
      items: [
        {
          id: "review-synthesis:branching-review",
          subjectRefs: ["work-item:wi-60382"],
          sourceFindingRefs: ["finding:scope-ambiguity"],
          decisionTopic: "Follow-up branch selection",
          openQuestion: "Should this split into a separate ADR slice?",
          recommendedAnswer: "Yes, split the architecture decision out.",
          rationale: "The finding identifies an architecture decision that needs approval.",
          evidenceRefs: ["record:approval-note"],
          blockingReason: "The branch decision is still unresolved.",
          decisionBranches: [
            {
              id: "branch-adr",
              label: "Create ADR slice",
              summary: "Move the architecture decision into a focused proposal.",
            },
            {
              id: "branch-afk",
              label: "Keep AFK implementation",
              summary: "Proceed only if the decision is already accepted.",
            },
          ],
          recommendedDecisionOrder: ["branch-adr", "branch-afk"],
          priority: "high",
          confidence: 0.91,
          requiredApprovals: [
            { scope: "architecture", authority: "governance" },
          ],
        },
      ],
    });

    expect(capture).toMatchObject({
      schemaVersion: "backlog-review-synthesis/v1",
      kind: "backlog-review-synthesis",
      report: {
        reportId: "backlog-review:wi-60382",
        profileId: "backlog-review",
      },
    });

    const json = JSON.parse(formatBacklogReviewSynthesisJson(capture));
    expect(json.items[0].decisionTopic).toBe("Follow-up branch selection");

    const text = formatBacklogReviewSynthesisText(capture, [
      {
        ref: "finding:scope-ambiguity",
        summary: "The report contains an architecture decision but no explicit branch.",
      },
    ]);
    expect(text).toContain("Open Question");
    expect(text).toContain("Recommended   : Yes, split the architecture decision out.");
    expect(text).toContain("Required Approvals: architecture/governance");
    expect(text).toContain("Recommended Order: branch-adr -> branch-afk");
    expect(text).toContain("Finding finding:scope-ambiguity: The report contains an architecture decision but no explicit branch.");
    expect(text).not.toContain("choose between");
  });

  it("builds schema-backed proposal batches with deterministic ids and dedupe keys", async () => {
    const batch = await buildWorkItemProposalBatch({
      source: {
        reportId: "backlog-review:wi-60382",
        synthesisId: "review-synthesis:branching-review",
        profileId: "backlog-review",
      },
      proposals: [
        {
          frontmatter: {
            $schema: "schemas/work-management/frontmatter/work-item.json",
            title: "Branch the review follow-up",
            summary: "Create a narrow ADR-backed follow-up.",
            type: "work-item",
            subtype: "task",
            lifecycle: "active",
            status: "ready",
            priority: "medium",
            estimated: 1,
            tags: ["afk"],
          },
          content: {
          entityType: "work-item",
          goal: "Create a narrow ADR-backed follow-up.",
          tasks: [
            {
              text: "Draft the ADR slice",
              done: false,
            },
          ],
            acceptanceCriteria: [
              {
                text: "The ADR slice is scoped and reviewable.",
                done: false,
              },
            ],
            relationships: [
              {
                type: "depends_on",
                target: "work-item:review-synthesis-60382",
              },
            ],
          },
          provenance: {
            reportId: "backlog-review:wi-60382",
            synthesisId: "review-synthesis:branching-review",
            profileId: "backlog-review",
            synthesisItemId: "review-synthesis:branching-review",
            subjectRefs: ["work-item:wi-60382"],
            sourceFindingRefs: ["finding:scope-ambiguity"],
            decisionBranchRefs: ["branch-adr"],
          },
          requiredApprovals: [],
        },
        {
          frontmatter: {
            $schema: "schemas/work-management/frontmatter/work-item.json",
            title: "Branch the review follow-up",
            summary: "Create a sibling proposal for the second branch.",
            type: "work-item",
            subtype: "task",
            lifecycle: "active",
            status: "ready",
            priority: "medium",
            estimated: 1,
          },
          content: {
          entityType: "work-item",
          goal: "Create a sibling proposal for the second branch.",
          tasks: [
            {
              text: "Document the alternate path",
              done: false,
            },
          ],
            acceptanceCriteria: [
              {
                text: "The alternate path is distinct from the first proposal.",
                done: false,
              },
            ],
            relationships: [
              {
                type: "depends_on",
                target: "work-item:review-synthesis-60382",
              },
            ],
          },
          provenance: {
            reportId: "backlog-review:wi-60382",
            synthesisId: "review-synthesis:branching-review",
            profileId: "backlog-review",
            synthesisItemId: "review-synthesis:branching-review",
            subjectRefs: ["work-item:wi-60382"],
            sourceFindingRefs: ["finding:scope-ambiguity"],
            decisionBranchRefs: ["branch-afk"],
          },
          requiredApprovals: [
            { scope: "architecture", authority: "governance" },
          ],
        },
      ],
    });

    expect(batch.schemaVersion).toBe("work-item-proposal-batch/v1");
    expect(batch.kind).toBe("work-item-proposal-batch");
    expect(batch.materializationMode).toBe("propose-only");
    expect(batch.proposals).toHaveLength(2);
    expect(batch.proposals[0].frontmatter.id).toBe("work-item:branch-the-review-follow-up");
    expect(batch.proposals[1].frontmatter.id).toMatch(
      /^work-item:branch-the-review-follow-up-[a-f0-9]{8,32}$/,
    );
    expect(batch.proposals[0].dedupeKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(batch.proposals[1].dedupeKey).toMatch(/^sha256:[a-f0-9]{64}$/);

    await expect(validateWorkItemProposalBatch(batch)).resolves.toBeUndefined();
    expect(JSON.parse(formatWorkItemProposalBatchJson(batch))).toMatchObject({
      kind: "work-item-proposal-batch",
      materializationMode: "propose-only",
    });
    expect(formatWorkItemProposalBatchText(batch)).toContain("Work Item Proposal Batch");
  });

  it("rejects duplicate proposal identifiers and AFK proposals with approvals", async () => {
    const duplicateProposal = {
      frontmatter: {
        $schema: "schemas/work-management/frontmatter/work-item.json",
        title: "Duplicate branch",
        summary: "Duplicate branch proposal.",
        type: "work-item",
        subtype: "task",
        lifecycle: "active",
        status: "ready",
        priority: "medium",
        estimated: 1,
        tags: ["afk"],
      },
      content: {
        entityType: "work-item",
        goal: "Duplicate branch proposal.",
        tasks: [
          {
            text: "Capture the duplicate branch",
            done: false,
          },
        ],
        acceptanceCriteria: [
          { text: "The branch is captured once.", done: false },
        ],
        relationships: [
          {
            type: "depends_on",
            target: "work-item:60382-review-synthesis",
          },
        ],
      },
      provenance: {
        reportId: "backlog-review:wi-60382",
        synthesisId: "review-synthesis:branching-review",
        profileId: "backlog-review",
        synthesisItemId: "review-synthesis:branching-review",
        subjectRefs: ["work-item:wi-60382"],
        sourceFindingRefs: ["finding:scope-ambiguity"],
        decisionBranchRefs: ["branch-adr"],
      },
      requiredApprovals: [],
    } as const;

    await expect(
      buildWorkItemProposalBatch({
        source: {
          reportId: "backlog-review:wi-60382",
          synthesisId: "review-synthesis:branching-review",
          profileId: "backlog-review",
        },
        proposals: [duplicateProposal, duplicateProposal],
      }),
    ).rejects.toThrow(/Duplicate proposal dedupeKey/i);

    await expect(
      buildWorkItemProposalBatch({
        source: {
          reportId: "backlog-review:wi-60382",
          synthesisId: "review-synthesis:branching-review",
          profileId: "backlog-review",
        },
        proposals: [
          {
            ...duplicateProposal,
            requiredApprovals: [
              { scope: "architecture", authority: "governance" },
            ],
            frontmatter: {
              ...duplicateProposal.frontmatter,
              tags: ["afk"],
            },
          },
        ],
      }),
    ).rejects.toThrow(/must not include the afk tag/i);
  });

  it("does not mutate files while rendering synthesis or proposal output", async () => {
    const root = await mkTmpRoot();
    await fs.writeFile(
      path.join(root, "backlog.md"),
      "deterministic content\n",
      "utf8",
    );
    const before = await snapshot(root);

    const capture = createReviewSynthesisCapture({
      report: { reportId: "backlog-review:wi-60382", profileId: "backlog-review" },
      subjectRefs: ["work-item:wi-60382"],
      sourceFindingRefs: ["finding:scope-ambiguity"],
      items: [
        {
          id: "review-synthesis:read-only",
          subjectRefs: ["work-item:wi-60382"],
          sourceFindingRefs: ["finding:scope-ambiguity"],
          decisionTopic: "Read only",
          openQuestion: "Should the renderer mutate files?",
          recommendedAnswer: "No",
          rationale: "The capture surface is non-mutating.",
          evidenceRefs: ["record:proof"],
          blockingReason: "No write path is needed.",
          decisionBranches: [
            {
              id: "branch-read-only",
              label: "Keep it read only",
              summary: "Render prompts and proposal batches in memory only.",
            },
          ],
          recommendedDecisionOrder: ["branch-read-only"],
          priority: "medium",
          confidence: 1,
          requiredApprovals: [],
        },
      ],
    });

    const batch = await buildWorkItemProposalBatch({
      source: {
        reportId: "backlog-review:wi-60382",
        synthesisId: "review-synthesis:read-only",
        profileId: "backlog-review",
      },
      proposals: [
        {
          frontmatter: {
            $schema: "schemas/work-management/frontmatter/work-item.json",
            title: "Read only branch",
            summary: "Keep the capture surface non-mutating.",
            type: "work-item",
            subtype: "task",
            lifecycle: "active",
            status: "ready",
            priority: "medium",
            estimated: 1,
          },
          content: {
            entityType: "work-item",
            goal: "Keep the capture surface non-mutating.",
            tasks: [
              {
                text: "Render text and JSON only",
                done: false,
              },
            ],
            acceptanceCriteria: [
              {
                text: "The proposal output does not write files.",
                done: false,
              },
            ],
            relationships: [
              {
                type: "depends_on",
                target: "work-item:review-synthesis-60382",
              },
            ],
          },
          provenance: {
            reportId: "backlog-review:wi-60382",
            synthesisId: "review-synthesis:read-only",
            profileId: "backlog-review",
            synthesisItemId: "review-synthesis:read-only",
            subjectRefs: ["work-item:wi-60382"],
            sourceFindingRefs: ["finding:scope-ambiguity"],
            decisionBranchRefs: ["branch-read-only"],
          },
          requiredApprovals: [],
        },
      ],
    });

    expect(formatBacklogReviewSynthesisText(capture)).toContain("Read only");
    expect(formatWorkItemProposalBatchText(batch)).toContain("Read only branch");

    const after = await snapshot(root);
    expect(after).toEqual(before);
  });
});
