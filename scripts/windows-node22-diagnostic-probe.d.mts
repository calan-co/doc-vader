export const APPROVED_TARGET_SHA: string;

export interface DiagnosticInputs {
  iterations: string | number;
  artifactLabel: string;
}

export interface ProbePhase {
  id: "baseline" | "serial" | "two-process" | "four-process";
  processes: number;
  vitestWorkers: number;
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
  runtimeTelemetry?: Record<string, string>;
}): Record<string, unknown>;
export function shouldCopySubjectPath(source: string): boolean;
export function runSample(input: {
  phase: Pick<ProbePhase, "id" | "fullSuite">;
  coldWarm: "cold" | "warm";
  iteration: number;
  childIndex: number;
  subject: string;
  root: string;
  sharedEnv: Record<string, string | undefined>;
  runtimeTelemetry: Record<string, string>;
  verifiedSubjectSha: string;
  reuse?: { workspace: string; pnpmStore: string };
}): Promise<{
  result: Record<string, unknown> & { gitHead: string };
  reuse: { workspace: string; pnpmStore: string };
}>;
export function waveBudgetForPhase(
  phase: Pick<ProbePhase, "fullSuite">,
): number;
export function shouldStopForBudget(input: {
  startedAtMs: number;
  nowMs: number;
  nextSampleBudgetMs: number;
}): boolean;
export interface ProbeRate {
  planned: number;
  executed: number;
  failed: number;
  timedOut: number;
}

export function summarizeProbeResults(input: {
  plan: ReturnType<typeof createProbePlan>;
  results: Array<{
    phase: string;
    coldWarm: string;
    probe?: { code?: number | null; timedOut?: boolean };
  }>;
  incomplete: boolean;
}): {
  targetSha: string;
  incomplete: boolean;
  rates: Record<string, ProbeRate>;
  results: Array<unknown>;
};
