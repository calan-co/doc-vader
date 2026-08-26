export const APPROVED_TARGET_SHA: string;

export interface DiagnosticInputs {
  iterations: string | number;
  artifactLabel: string;
}

export interface ProbePhase {
  id: "baseline" | "serial" | "two-process" | "four-process";
  workers: number;
  iterations: number;
  coldWarm: readonly ("cold" | "warm")[];
  fullSuite?: boolean;
}

export function parseDiagnosticInputs(input: DiagnosticInputs): {
  iterations: number;
  artifactLabel: string;
};
export function createProbePlan(input: DiagnosticInputs): {
  targetSha: string;
  artifactLabel: string;
  focusedArgs: string[];
  phases: ProbePhase[];
};
export function createProbeManifestEntry(input: {
  phase: string;
  coldWarm: string;
  iteration: number;
  childIndex: number;
  workspace: string;
  pnpmStore: string;
  stdoutPath: string;
  stderrPath: string;
}): Record<string, unknown>;
