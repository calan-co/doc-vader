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
export function terminateProcessTree(
  child: { pid?: number; kill(signal?: string): unknown },
  options?: {
    platform?: string;
    taskkillSettlementWaitMs?: number;
    spawnProcess?: (
      command: string,
      args: string[],
      options: { shell: boolean; windowsHide: boolean },
    ) => {
      once(event: string, listener: (...args: unknown[]) => void): unknown;
    };
  },
): Promise<void>;
export function run(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: Record<string, string | undefined>;
    stdoutPath: string;
    stderrPath: string;
    timeoutMs: number;
    postCleanupWaitMs?: number;
    taskkillSettlementWaitMs?: number;
    platform?: string;
    spawnProcess?: (
      command: string,
      args: string[],
      options: {
        cwd: string;
        env: Record<string, string | undefined>;
        shell: boolean;
        windowsHide: boolean;
      },
    ) => any;
  },
): Promise<Record<string, unknown> & { timedOut: boolean }>;
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
  runOperation?: typeof run;
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
export function shouldStopAfterUnobservedTermination(
  results: Array<{
    install?: { cleanup?: { terminationObserved?: boolean } };
    build?: { cleanup?: { terminationObserved?: boolean } };
    probe?: { cleanup?: { terminationObserved?: boolean } };
  }>,
): boolean;
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
