import { describe, expect, it } from "vitest";
import {
  APPROVED_TARGET_SHA,
  createProbePlan,
  createProbeManifestEntry,
  parseDiagnosticInputs,
  shouldCopySubjectPath,
  shouldStopForBudget,
  summarizeProbeResults,
} from "../windows-node22-diagnostic-probe.mjs";

describe("Windows Node 22 diagnostic probe contract", () => {
  it("rejects unbounded iterations and unsafe artifact labels", () => {
    expect(() =>
      parseDiagnosticInputs({ iterations: "0", artifactLabel: "wi60495" }),
    ).toThrow(/iterations/i);
    expect(() =>
      parseDiagnosticInputs({ iterations: "31", artifactLabel: "wi60495" }),
    ).toThrow(/iterations/i);
    expect(() =>
      parseDiagnosticInputs({ iterations: "1", artifactLabel: "bad label" }),
    ).toThrow(/artifact label/i);
  });

  it("plans 30-capable CI-equivalent one-process four-worker baselines before controlled waves", () => {
    const plan = createProbePlan({ iterations: 2, artifactLabel: "wi60495" });
    expect(plan.targetSha).toBe(APPROVED_TARGET_SHA);
    expect(plan.phases.map((phase: { id: string }) => phase.id)).toEqual([
      "baseline",
      "serial",
      "two-process",
      "four-process",
    ]);
    expect(plan.phases[0]).toMatchObject({
      processes: 1,
      vitestWorkers: 4,
      iterations: 2,
      coldWarm: ["cold", "warm"],
      fullSuite: true,
    });
    expect(
      plan.phases
        .slice(1)
        .map((phase: { processes: number }) => phase.processes),
    ).toEqual([1, 2, 4]);
    expect(
      plan.phases
        .slice(1)
        .every((phase: { vitestWorkers: number }) => phase.vitestWorkers === 1),
    ).toBe(true);
    expect(
      plan.phases
        .slice(1)
        .every((phase: { iterations: number }) => phase.iterations === 2),
    ).toBe(true);
    expect(plan.focusedArgs).toEqual(
      expect.arrayContaining([
        "tests/task-command.test.ts",
        "-t",
        expect.stringContaining("selects ready tasks"),
        "--pool=forks",
        "--no-file-parallelism",
      ]),
    );
  });

  it("requires independently addressable evidence fields and runtime telemetry for every sample", () => {
    expect(
      createProbeManifestEntry({
        phase: "serial",
        coldWarm: "cold",
        iteration: 1,
        childIndex: 0,
        workspace: "C:/temp/workspace",
        pnpmStore: "C:/temp/store",
        stdoutPath: "stdout.log",
        stderrPath: "stderr.log",
        runtimeTelemetry: { nodeVersion: "v22.23.2", imageVersion: "image" },
      }),
    ).toEqual(
      expect.objectContaining({
        targetSha: APPROVED_TARGET_SHA,
        phase: "serial",
        coldWarm: "cold",
        command: expect.any(Array),
        effectiveOptions: expect.any(Object),
        stdoutPath: "stdout.log",
        stderrPath: "stderr.log",
        lockfileSha256: expect.any(String),
        telemetry: expect.objectContaining({
          nodeVersion: "v22.23.2",
          imageVersion: "image",
        }),
      }),
    );
  });

  it("emits planned, executed, failed, and timed-out rates by phase and temperature", () => {
    const plan = createProbePlan({ iterations: 2, artifactLabel: "wi60495" });
    const summary = summarizeProbeResults({
      plan,
      results: [
        {
          phase: "baseline",
          coldWarm: "cold",
          probe: { code: 0, timedOut: false },
        },
        {
          phase: "baseline",
          coldWarm: "warm",
          probe: { code: null, timedOut: true },
        },
      ],
      incomplete: true,
    });
    expect(summary.incomplete).toBe(true);
    expect(summary.rates["baseline/cold"]).toMatchObject({
      planned: 2,
      executed: 1,
      failed: 0,
      timedOut: 0,
    });
    expect(summary.rates["baseline/warm"]).toMatchObject({
      planned: 2,
      executed: 1,
      failed: 1,
      timedOut: 1,
    });
    expect(summary.rates["four-process/cold"].planned).toBe(8);
  });

  it("stops before the execution budget and excludes Git metadata from copied workspaces", () => {
    expect(
      shouldStopForBudget({
        startedAtMs: 0,
        nowMs: 329 * 60_000,
        nextSampleBudgetMs: 5 * 60_000,
      }),
    ).toBe(true);
    expect(shouldCopySubjectPath("C:/subject/.git/config")).toBe(false);
    expect(shouldCopySubjectPath("C:/subject/src/index.ts")).toBe(true);
  });
});
