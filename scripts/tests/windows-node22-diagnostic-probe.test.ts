import { describe, expect, it } from "vitest";
import {
  APPROVED_TARGET_SHA,
  createProbePlan,
  createProbeManifestEntry,
  parseDiagnosticInputs,
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

  it("plans the fixed baseline followed by serial, two-process, and four-process waves", () => {
    const plan = createProbePlan({ iterations: 2, artifactLabel: "wi60495" });
    expect(plan.targetSha).toBe(APPROVED_TARGET_SHA);
    expect(plan.phases.map((phase: { id: string }) => phase.id)).toEqual([
      "baseline",
      "serial",
      "two-process",
      "four-process",
    ]);
    expect(plan.phases[0]).toMatchObject({
      workers: 4,
      iterations: 1,
      coldWarm: ["cold", "warm"],
    });
    expect(
      plan.phases.slice(1).map((phase: { workers: number }) => phase.workers),
    ).toEqual([1, 2, 4]);
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

  it("requires independently addressable evidence fields for every sample", () => {
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
        telemetry: expect.objectContaining({ nodeVersion: expect.any(String) }),
      }),
    );
  });
});
