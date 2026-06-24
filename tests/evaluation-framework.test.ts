import { describe, expect, it } from "vitest";
import {
  assembleReviewReport,
  collectSortedStrings,
  composeReviewProfile,
  createFinding,
  createReviewProfile,
  createReviewProfileRegistry,
  executeReviewProfile,
  serializeEvaluationReport,
  type EvaluationCheck,
  type EvaluationFinding,
  type EvaluationReviewProfile,
  type EvaluationSubject,
} from "../lib/evaluation/index.js";

function makeSubject(
  id: string,
  type = "work-item",
): EvaluationSubject {
  return {
    type,
    id,
    title: `Subject ${id}`,
    ref: `[[${id}]]`,
    tags: ["afk"],
  };
}

function makeCheck(
  id: string,
  reasonCode: string,
  executionOrder: string[],
): EvaluationCheck<EvaluationSubject, Record<string, string>, EvaluationFinding> {
  return Object.assign(
    async ({ subject }) => {
      executionOrder.push(id);
      return {
        findings: [
          createFinding({
            subject,
            checkId: id,
            disposition: "warn",
            severity: "warn",
            reasonCode,
            evidence: [
              {
                ref: `evidence:${subject.id}:${id}`,
                label: `${subject.id} evidence`,
                details: { checkId: id },
              },
            ],
            blocking: false,
            followUps: [
              {
                ref: `follow-up:${subject.id}:${id}`,
                label: "Follow up",
              },
            ],
            message: `Finding from ${id}`,
          }),
        ],
      };
    },
    {
      id,
      label: `Check ${id}`,
      description: `Check ${id} description`,
    },
  );
}

function makeConstantCheck(
  id: string,
  findings: readonly EvaluationFinding[],
): EvaluationCheck<EvaluationSubject, Record<string, string>, EvaluationFinding> {
  return Object.assign(async () => ({ findings }), { id });
}

function makeProfile(
  id: string,
  checks: readonly EvaluationCheck<EvaluationSubject, Record<string, string>, EvaluationFinding>[],
  summaryKeys: readonly string[],
): EvaluationReviewProfile<EvaluationSubject, Record<string, string>, EvaluationFinding> {
  return createReviewProfile({
    id,
    label: `Profile ${id}`,
    description: `Profile ${id} description`,
    checks,
    summaryRules: summaryKeys.map((key) => ({
      key,
      compute: (findings) =>
        collectSortedStrings(
          findings
            .filter((finding) => finding.disposition !== "pass")
            .map((finding) => `${finding.subject.id}:${finding.checkId}`),
        ),
    })),
  });
}

describe("evaluation foundation", () => {
  it("creates stable finding and report contracts for JSON consumers", () => {
    const finding = createFinding({
      subject: makeSubject("wi-1"),
      checkId: "check-alpha",
      disposition: "fail",
      severity: "error",
      reasonCode: "missing-evidence",
      evidence: [
        {
          ref: "record:wi-1",
          label: "Record evidence",
          details: { source: "task" },
        },
      ],
      blocking: true,
      followUps: [
        {
          ref: "[[wi-2]]",
          label: "Follow up",
        },
      ],
      message: "A stable finding",
      details: { field: "status" },
    });

    const profile = createReviewProfile({
      id: "profile-alpha",
      label: "Profile alpha",
      checks: [makeConstantCheck("check-alpha", [finding])],
      summaryRules: [
        {
          key: "subjects",
          compute: (findings) => collectSortedStrings(findings.map((entry) => entry.subject.id)),
        },
      ],
    });

    const report = assembleReviewReport(
      profile,
      {
        profileId: "profile-alpha",
        executionId: "exec-1",
        startedAt: "2026-06-22T12:00:00.000Z",
        completedAt: "2026-06-22T12:00:00.100Z",
        subjectCount: 1,
        checkCount: 1,
      },
      [finding],
    );

    const roundTrip = JSON.parse(serializeEvaluationReport(report)) as typeof report;

    expect(finding.schemaVersion).toBe("evaluation-finding/v1");
    expect(finding.evidence[0]).toMatchObject({
      ref: "record:wi-1",
      label: "Record evidence",
    });
    expect(finding.followUps?.[0]).toMatchObject({
      ref: "[[wi-2]]",
      label: "Follow up",
    });
    expect(roundTrip.schemaVersion).toBe("evaluation-report/v1");
    expect(roundTrip.profile.checkIds).toEqual(["check-alpha"]);
    expect(roundTrip.summary.subjects).toEqual(["wi-1"]);
    expect(roundTrip.findings[0]).toMatchObject({
      schemaVersion: "evaluation-finding/v1",
      checkId: "check-alpha",
      reasonCode: "missing-evidence",
      blocking: true,
    });
  });

  it("assembles findings and summary values deterministically", async () => {
    const executionOrder: string[] = [];
    const checkAlpha = makeCheck("check-alpha", "alpha-reason", executionOrder);
    const checkBeta = makeCheck("check-beta", "beta-reason", executionOrder);
    const baseProfile = makeProfile("base", [checkAlpha], ["subjects"]);
    const extensionProfile = makeProfile("extension", [checkBeta], ["checks"]);
    const composed = composeReviewProfile({
      id: "composed",
      label: "Composed profile",
      profiles: [baseProfile, extensionProfile],
    });

    const report = await executeReviewProfile(composed, {
      executionId: "exec-2",
      subjects: [makeSubject("wi-b"), makeSubject("wi-a")],
      context: { scope: "demo" },
      startedAt: "2026-06-22T12:00:00.000Z",
      completedAt: "2026-06-22T12:00:00.500Z",
    });

    expect(executionOrder).toEqual([
      "check-alpha",
      "check-beta",
      "check-alpha",
      "check-beta",
    ]);
    expect(report.profile.checkIds).toEqual([
      "check-alpha",
      "check-beta",
    ]);
    expect(report.profile.summaryRuleKeys).toEqual(["subjects", "checks"]);
    expect(report.findings.map((finding) => `${finding.subject.id}:${finding.checkId}`)).toEqual([
      "wi-a:check-alpha",
      "wi-a:check-beta",
      "wi-b:check-alpha",
      "wi-b:check-beta",
    ]);
    expect(report.summary.subjects).toEqual([
      "wi-a:check-alpha",
      "wi-a:check-beta",
      "wi-b:check-alpha",
      "wi-b:check-beta",
    ]);
    expect(report.summary.checks).toEqual([
      "wi-a:check-alpha",
      "wi-a:check-beta",
      "wi-b:check-alpha",
      "wi-b:check-beta",
    ]);
  });

  it("registers and discovers review profiles without hard-coding a domain", () => {
    const registry = createReviewProfileRegistry();
    const profile = makeProfile("registry-profile", [], ["subjects"]);

    registry.register(profile);

    expect(registry.get("registry-profile")).toBe(profile);
    expect(registry.list().map((entry) => entry.id)).toEqual(["registry-profile"]);
    expect(() => registry.register({ ...profile })).toThrow(
      /Duplicate review profile id 'registry-profile'./,
    );
  });

  it("inherits the first defined profile description when composing profiles", () => {
    const baseProfile = createReviewProfile({
      id: "base",
      label: "Base profile",
      checks: [],
      summaryRules: [],
    });
    const extensionProfile = createReviewProfile({
      id: "extension",
      label: "Extension profile",
      description: "Extension profile description",
      checks: [],
      summaryRules: [],
    });

    const composed = composeReviewProfile({
      id: "composed",
      label: "Composed profile",
      profiles: [baseProfile, extensionProfile],
    });

    expect(composed.description).toBe("Extension profile description");
  });
});
