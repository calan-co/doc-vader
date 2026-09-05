import { describe, expect, it } from "vitest";
import * as docVader from "../lib/index.js";
import {
  assembleWorkEvaluationReport,
  createWorkEvaluationFinding,
  createWorkReviewProfile,
  serializeWorkEvaluationReport,
} from "../lib/work/index.js";

describe("work evaluation report adapter", () => {
  it("exposes the shared evaluation report contract through the work pack", () => {
    const finding = createWorkEvaluationFinding({
      subject: {
        type: "work-item",
        id: "wi-60427",
        title: "Evaluation adapter alignment",
      },
      checkId: "work.evaluation.adapter",
      disposition: "warn",
      severity: "warn",
      reasonCode: "adapter_alignment",
      evidence: [{ ref: "[[wi-60427]]", label: "Issue reference" }],
      blocking: false,
      message: "Work pack adapter remained aligned with the shared report contract.",
    });

    const profile = createWorkReviewProfile({
      id: "work-evaluation-adapter",
      label: "Work evaluation adapter",
      checks: [],
      summaryRules: [
        {
          key: "subjectIds",
          compute: (findings) => findings.map((entry) => entry.subject.id),
        },
      ],
    });

    const report = assembleWorkEvaluationReport(
      profile,
      {
        profileId: profile.id,
        executionId: "exec-60427",
        startedAt: "2026-07-04T00:00:00.000Z",
        completedAt: "2026-07-04T00:00:01.000Z",
        subjectCount: 1,
        checkCount: 0,
      },
      [finding],
    );

    expect(docVader.work).toBeDefined();
    expect(docVader.work.assembleWorkEvaluationReport).toBe(
      assembleWorkEvaluationReport,
    );
    expect(docVader.work.createWorkEvaluationFinding).toBe(
      createWorkEvaluationFinding,
    );
    expect(docVader.work.createWorkReviewProfile).toBe(createWorkReviewProfile);
    expect(JSON.parse(serializeWorkEvaluationReport(report))).toMatchObject({
      schemaVersion: "evaluation-report/v1",
      profile: {
        id: "work-evaluation-adapter",
        checkIds: [],
      },
      summary: {
        subjectIds: ["wi-60427"],
      },
      findings: [
        {
          schemaVersion: "evaluation-finding/v1",
          reasonCode: "adapter_alignment",
        },
      ],
    });
  });
});
