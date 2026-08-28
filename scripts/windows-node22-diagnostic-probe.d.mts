export const APPROVED_TARGET_SHA: string;
export function packageManagerCommand(platform?: string): string;
export function hasSetupFailure(result: {
  install?: ProbeStep;
  build?: ProbeStep;
  probe?: ProbeStep;
}): boolean;

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
  platform?: string;
}): Record<string, unknown> & { command: string[] };
export function shouldCopySubjectPath(source: string): boolean;
export interface ProcessTreeTerminationResult {
  attempted: boolean;
  failed: boolean;
  taskkillExitCode?: number | null;
  taskkillError?: string;
  fallback?: string;
  fallbackSucceeded?: boolean;
  fallbackError?: string;
  taskkillSettlementDeadlineExceeded?: boolean;
}

export function terminateProcessTree(
  child: {
    pid?: number;
    kill?(signal?: string): unknown;
    unref?(): unknown;
    stdin?: { end?(): unknown; destroy?(): unknown; unref?(): unknown };
    stdout?: { destroy?(): unknown };
    stderr?: { destroy?(): unknown };
  },
  options?: {
    platform?: string;
    taskkillSettlementWaitMs?: number;
    spawnProcess?: (
      command: string,
      args: string[],
      options: { shell: boolean; windowsHide: boolean },
    ) => {
      once(event: string, listener: (...args: unknown[]) => void): unknown;
      kill?(signal?: string): unknown;
      unref?(): unknown;
      stdin?: { end?(): unknown; destroy?(): unknown; unref?(): unknown };
      stdout?: { destroy?(): unknown };
      stderr?: { destroy?(): unknown };
    };
  },
): Promise<ProcessTreeTerminationResult>;
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
  result: Record<string, unknown> & {
    gitHead: string;
    stdoutPath: string;
    stderrPath: string;
  };
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

export interface ProbeStep {
  code?: number | null;
  timedOut?: boolean;
  skipped?: boolean;
  error?: string | null;
}

export function summarizeProbeResults(input: {
  plan: ReturnType<typeof createProbePlan>;
  results: Array<{
    phase: string;
    coldWarm: string;
    install?: ProbeStep;
    build?: ProbeStep;
    probe?: ProbeStep;
  }>;
  incomplete: boolean;
}): {
  targetSha: string;
  incomplete: boolean;
  rates: Record<string, ProbeRate>;
  results: Array<unknown>;
};
