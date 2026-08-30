import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  APPROVED_TARGET_SHA,
  hasSetupFailure,
  packageManagerCommand,
  createProbePlan,
  createProbeManifestEntry,
  parseDiagnosticInputs,
  shouldCopySubjectPath,
  shouldStopForBudget,
  shouldStopAfterUnobservedTermination,
  shouldUseWindowsCmdShell,
  summarizeProbeResults,
  run,
  runSample,
  terminateProcessTree,
  waveBudgetForPhase,
} from "../windows-node22-diagnostic-probe";

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

  it("uses the Windows Corepack shim with cmd and records the executable", () => {
    expect(packageManagerCommand("win32")).toBe("pnpm.cmd");
    expect(packageManagerCommand("linux")).toBe("pnpm");
    expect(shouldUseWindowsCmdShell("pnpm.cmd", "win32")).toBe(true);
    expect(shouldUseWindowsCmdShell("pnpm", "win32")).toBe(false);
    expect(shouldUseWindowsCmdShell("pnpm.cmd", "linux")).toBe(false);
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
        platform: "win32",
      }).command[0],
    ).toBe("pnpm.cmd");
  });

  it("marks install or build failures as invalid diagnostic setup", () => {
    expect(
      hasSetupFailure({ install: { code: null, error: "spawn pnpm ENOENT" } }),
    ).toBe(true);
    expect(hasSetupFailure({ build: { code: 1 } })).toBe(true);
    expect(hasSetupFailure({ probe: { code: 1 } })).toBe(false);
    expect(hasSetupFailure({ install: { code: 0 }, build: { code: 0 } })).toBe(
      false,
    );
  });

  it("counts install and build failures or timeouts in phase rates", () => {
    const summary = summarizeProbeResults({
      plan: createProbePlan({ iterations: 1, artifactLabel: "wi60495" }),
      results: [
        {
          phase: "serial",
          coldWarm: "cold",
          install: { code: 1, timedOut: false },
          build: { skipped: true },
          probe: { skipped: true },
        },
        {
          phase: "two-process",
          coldWarm: "cold",
          install: { code: 0, timedOut: false },
          build: { code: null, timedOut: true },
          probe: { skipped: true },
        },
      ],
      incomplete: false,
    });
    expect(summary.rates["serial/cold"]).toMatchObject({
      failed: 1,
      timedOut: 0,
    });
    expect(summary.rates["two-process/cold"]).toMatchObject({
      failed: 1,
      timedOut: 1,
    });
  });

  it("reserves a complete cold focused sample plus margin at the execution-budget boundary", () => {
    expect(waveBudgetForPhase({ fullSuite: false })).toBe(55 * 60_000);
    expect(
      shouldStopForBudget({
        startedAtMs: 0,
        nowMs: 275 * 60_000,
        nextSampleBudgetMs: 55 * 60_000,
      }),
    ).toBe(false);
    expect(
      shouldStopForBudget({
        startedAtMs: 0,
        nowMs: 275 * 60_000 + 1,
        nextSampleBudgetMs: 55 * 60_000,
      }),
    ).toBe(true);
    expect(shouldCopySubjectPath("C:/subject/.git/config")).toBe(false);
    expect(shouldCopySubjectPath("C:/subject/src/index.ts")).toBe(true);
  });

  it("terminates Windows descendant process trees and waits for taskkill completion", async () => {
    const taskkill = new (await import("node:events")).EventEmitter() as any;
    const calls: Array<{ command: string; args: string[]; options: object }> =
      [];
    const child = {
      pid: 1234,
      kill: () => {
        throw new Error("Windows cleanup must use taskkill, not child.kill");
      },
    };
    const cleanup = terminateProcessTree(child, {
      platform: "win32",
      spawnProcess: (command: string, args: string[], options: object) => {
        calls.push({ command, args, options });
        return taskkill;
      },
    });
    expect(calls).toEqual([
      {
        command: "taskkill",
        args: ["/pid", "1234", "/t", "/f"],
        options: { shell: false, windowsHide: true },
      },
    ]);
    let settled = false;
    void cleanup.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    taskkill.emit("close", 0);
    await expect(cleanup).resolves.toMatchObject({
      attempted: true,
      failed: false,
      taskkillExitCode: 0,
    });

    const signals: string[] = [];
    await terminateProcessTree(
      { pid: 4321, kill: (signal: string) => signals.push(signal) },
      {
        platform: "darwin",
        spawnProcess: () => {
          throw new Error("non-Windows cleanup must not spawn taskkill");
        },
      },
    );
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("lets a successful cold sample proceed to later probe phases", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    const root = mkdtempSync(join(tmpdir(), "wi60495-successful-cold-"));
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
        timeoutMs: 60_000,
        spawnProcess: () => child,
      });
      child.emit("close", 0, null);
      const coldProbe = await resultPromise;
      const successfulCleanup = coldProbe.cleanup as {
        terminationObserved?: boolean;
      };
      expect(successfulCleanup.terminationObserved).toBe(true);
      expect(
        shouldStopAfterUnobservedTermination([
          { probe: { cleanup: successfulCleanup } },
        ]),
      ).toBe(false);

      const subject = mkdtempSync(
        join(tmpdir(), "wi60495-next-phase-subject-"),
      );
      const sampleRoot = mkdtempSync(
        join(tmpdir(), "wi60495-next-phase-root-"),
      );
      writeFileSync(
        join(subject, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
      );
      const laterCalls: string[] = [];
      const { result } = await runSample({
        phase: { id: "serial" },
        coldWarm: "cold",
        iteration: 1,
        childIndex: 0,
        subject,
        root: sampleRoot,
        sharedEnv: {},
        runtimeTelemetry: {},
        verifiedSubjectSha: APPROVED_TARGET_SHA,
        runOperation: async (command: string, args: string[]) => {
          laterCalls.push([command, ...args].join(" "));
          return { code: 0, signal: null, error: null, timedOut: false };
        },
      });
      expect(result.incomplete).toBe(false);
      expect(laterCalls).toHaveLength(3);
      rmSync(subject, { recursive: true, force: true });
      rmSync(sampleRoot, { recursive: true, force: true });
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 10));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates nested evidence-log parents and flushes complete output before resolving", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    const root = mkdtempSync(join(tmpdir(), "wi60495-evidence-streams-"));
    const stdoutPath = join(root, "nested", "logs", "stdout.log");
    const stderrPath = join(root, "nested", "logs", "stderr.log");
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath,
        stderrPath,
        timeoutMs: 60_000,
        spawnProcess: () => child,
      });
      child.stdout.end("complete stdout\\n");
      child.stderr.end("complete stderr\\n");
      child.emit("close", 0, null);

      await expect(resultPromise).resolves.toMatchObject({ code: 0 });
      expect(readFileSync(stdoutPath, "utf8")).toBe("complete stdout\\n");
      expect(readFileSync(stderrPath, "utf8")).toBe("complete stderr\\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("waits for Windows process-tree cleanup before recording a timeout", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => {
        throw new Error("Windows timeout must not use child.kill directly");
      },
    });
    const taskkill = new EventEmitter();
    const calls: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "wi60495-timeout-"));
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
        timeoutMs: 1,
        platform: "win32",
        spawnProcess: (command: string) => {
          calls.push(command);
          return command === "taskkill" ? taskkill : child;
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toEqual(["pnpm", "taskkill"]);
      child.emit("close", null, "SIGTERM");
      let settled = false;
      void resultPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      taskkill.emit("close", 0);
      await expect(resultPromise).resolves.toMatchObject({ timedOut: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records a nonzero Windows taskkill cleanup failure, uses fallback, and waits for termination before timeout result", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killCalls: [] as string[],
      kill(signal: string) {
        this.killCalls.push(signal);
        return true;
      },
    });
    const taskkill = new EventEmitter();
    const root = mkdtempSync(join(tmpdir(), "wi60495-taskkill-nonzero-"));
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
        timeoutMs: 1,
        platform: "win32",
        spawnProcess: (command: string) =>
          command === "taskkill" ? taskkill : child,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      taskkill.emit("close", 1);
      expect(child.killCalls).toEqual(["SIGTERM"]);
      let settled = false;
      void resultPromise.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit("close", null, "SIGTERM");
      await expect(resultPromise).resolves.toMatchObject({
        timedOut: true,
        cleanup: {
          attempted: true,
          failed: true,
          taskkillExitCode: 1,
          fallback: "child.kill(SIGTERM)",
          terminationObserved: true,
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["false", () => false],
    [
      "throwing",
      () => {
        throw new Error("fallback failed");
      },
    ],
  ])(
    "records an incomplete timeout after a nonzero taskkill and a %s fallback without child close",
    async (_kind, fallback) => {
      const child = Object.assign(new EventEmitter(), {
        pid: 1234,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: fallback,
      });
      const taskkill = new EventEmitter();
      const root = mkdtempSync(join(tmpdir(), "wi60495-post-cleanup-"));
      try {
        const resultPromise = run("pnpm", ["run", "test"], {
          cwd: root,
          env: process.env,
          stdoutPath: join(root, "stdout.log"),
          stderrPath: join(root, "stderr.log"),
          timeoutMs: 1,
          postCleanupWaitMs: 5,
          platform: "win32",
          spawnProcess: (command: string) =>
            command === "taskkill" ? taskkill : child,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        taskkill.emit("close", 1);
        await expect(resultPromise).resolves.toMatchObject({
          timedOut: true,
          incomplete: true,
          cleanup: {
            attempted: true,
            failed: true,
            taskkillExitCode: 1,
            terminationObserved: false,
            postCleanupDeadlineExceeded: true,
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("records an incomplete timeout after a nonclosing fallback despite taskkill cleanup failure", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    const taskkill = new EventEmitter();
    const root = mkdtempSync(join(tmpdir(), "wi60495-nonclosing-fallback-"));
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
        timeoutMs: 1,
        postCleanupWaitMs: 5,
        platform: "win32",
        spawnProcess: (command: string) =>
          command === "taskkill" ? taskkill : child,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      taskkill.emit("close", 1);
      await expect(resultPromise).resolves.toMatchObject({
        timedOut: true,
        incomplete: true,
        cleanup: {
          terminationObserved: false,
          postCleanupDeadlineExceeded: true,
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates cold stores and reuses only the matching cold workspace for warm samples", async () => {
    const root = mkdtempSync(join(tmpdir(), "wi60495-store-isolation-"));
    try {
      const subject = join(root, "subject");
      mkdirSync(subject, { recursive: true });
      writeFileSync(
        join(subject, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
      );
      const operations: Array<{
        command: string;
        args: string[];
        cwd: string;
        store: string;
      }> = [];
      const runOperation = async (
        command: string,
        args: string[],
        options: { cwd: string; env: NodeJS.ProcessEnv },
      ) => {
        operations.push({
          command,
          args,
          cwd: options.cwd,
          store: options.env.PNPM_STORE_DIR ?? "",
        });
        return { code: 0, signal: null, timedOut: false };
      };
      const input = {
        phase: { id: "two-process" as const, fullSuite: false },
        iteration: 1,
        subject,
        root,
        sharedEnv: {},
        runtimeTelemetry: {},
        verifiedSubjectSha: APPROVED_TARGET_SHA,
        runOperation,
      };
      const cold0 = await runSample({
        ...input,
        coldWarm: "cold",
        childIndex: 0,
      });
      const cold1 = await runSample({
        ...input,
        coldWarm: "cold",
        childIndex: 1,
      });
      await runSample({
        ...input,
        coldWarm: "warm",
        childIndex: 0,
        reuse: cold0.reuse,
      });
      const installs = operations.filter(
        ({ command, args }) =>
          command === packageManagerCommand() && args[0] === "install",
      );
      expect(installs).toHaveLength(2);
      expect(installs[0]).toMatchObject({
        cwd: cold0.reuse.workspace,
        store: cold0.reuse.pnpmStore,
        args: expect.arrayContaining(["--store-dir", cold0.reuse.pnpmStore]),
      });
      expect(installs[1]).toMatchObject({
        cwd: cold1.reuse.workspace,
        store: cold1.reuse.pnpmStore,
        args: expect.arrayContaining(["--store-dir", cold1.reuse.pnpmStore]),
      });
      expect(cold0.reuse.workspace).not.toBe(cold1.reuse.workspace);
      expect(cold0.reuse.pnpmStore).not.toBe(cold1.reuse.pnpmStore);
      const warmOperations = operations.slice(6);
      expect(warmOperations).toHaveLength(2);
      expect(warmOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cwd: cold0.reuse.workspace,
            store: cold0.reuse.pnpmStore,
          }),
        ]),
      );
      expect(
        warmOperations.every(
          ({ cwd, store }) =>
            cwd === cold0.reuse.workspace && store === cold0.reuse.pnpmStore,
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes verified subject SHA in completed runSample result metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "wi60495-probe-"));
    try {
      const subject = join(root, "subject");
      const bin = join(root, "bin");
      mkdirSync(subject, { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(
        join(subject, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
      );
      const pnpm = join(
        bin,
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      );
      writeFileSync(
        pnpm,
        process.platform === "win32"
          ? "@echo off\r\nexit /b 0\r\n"
          : "#!/bin/sh\nexit 0\n",
      );
      if (process.platform !== "win32") chmodSync(pnpm, 0o755);
      const verifiedSubjectSha = APPROVED_TARGET_SHA;
      const cold = await runSample({
        phase: { id: "serial", fullSuite: false },
        coldWarm: "cold",
        iteration: 1,
        childIndex: 0,
        subject,
        root,
        sharedEnv: {
          PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        },
        runtimeTelemetry: {},
        verifiedSubjectSha,
      });
      const { result } = await runSample({
        phase: { id: "serial", fullSuite: false },
        coldWarm: "warm",
        iteration: 1,
        childIndex: 0,
        subject,
        root,
        sharedEnv: {
          PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        },
        runtimeTelemetry: {},
        verifiedSubjectSha,
        reuse: cold.reuse,
      });
      const resultPath = join(
        root,
        "samples",
        "serial",
        "iteration-1",
        "child-0",
        "warm",
        "metadata.result.json",
      );
      expect(JSON.parse(readFileSync(resultPath, "utf8")).gitHead).toBe(
        verifiedSubjectSha,
      );
      expect(result.gitHead).toBe(verifiedSubjectSha);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bounds a taskkill that never settles, detaches all target/taskkill stdio, and records incomplete timeout evidence", async () => {
    const targetStdin = Object.assign(new PassThrough(), {
      unrefCalls: 0,
      unref() {
        this.unrefCalls += 1;
      },
    });
    const taskkillStdin = Object.assign(new PassThrough(), {
      unrefCalls: 0,
      unref() {
        this.unrefCalls += 1;
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdin: targetStdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      unrefCalls: 0,
      kill: () => false,
      unref() {
        this.unrefCalls += 1;
      },
    });
    const taskkill = Object.assign(new EventEmitter(), {
      stdin: taskkillStdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const root = mkdtempSync(join(tmpdir(), "wi60495-taskkill-hang-"));
    try {
      const resultPromise = run("pnpm", ["run", "test"], {
        cwd: root,
        env: process.env,
        stdoutPath: join(root, "stdout.log"),
        stderrPath: join(root, "stderr.log"),
        timeoutMs: 1,
        taskkillSettlementWaitMs: 5,
        postCleanupWaitMs: 5,
        platform: "win32",
        spawnProcess: (command: string) =>
          command === "taskkill" ? taskkill : child,
      });
      await expect(resultPromise).resolves.toMatchObject({
        timedOut: true,
        incomplete: true,
        cleanup: {
          failed: true,
          taskkillSettlementDeadlineExceeded: true,
          terminationObserved: false,
          finalStrategy: "detach-live-handles",
        },
      });
      expect(child.unrefCalls).toBe(1);
      expect(child.stdin.destroyed).toBe(true);
      expect(child.stdin.unrefCalls).toBe(1);
      expect(child.stdout.destroyed).toBe(true);
      expect(child.stderr.destroyed).toBe(true);
      expect(taskkill.stdin.destroyed).toBe(true);
      expect(taskkill.stdin.unrefCalls).toBe(1);
      expect(taskkill.stdout.destroyed).toBe(true);
      expect(taskkill.stderr.destroyed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("halts later waves when any sample reports unobserved termination", () => {
    expect(
      shouldStopAfterUnobservedTermination([
        { probe: { cleanup: { terminationObserved: false } } },
      ]),
    ).toBe(true);
    expect(
      shouldStopAfterUnobservedTermination([
        { install: { cleanup: { terminationObserved: true } } },
      ]),
    ).toBe(false);
  });
});

describe("containment failure paths", () => {
  it("short-circuits an unobserved install termination without spawning build or probe", async () => {
    const subject = mkdtempSync(
      join(tmpdir(), "wi60495-unobserved-install-subject-"),
    );
    const root = mkdtempSync(
      join(tmpdir(), "wi60495-unobserved-install-root-"),
    );
    const calls: string[] = [];
    writeFileSync(join(subject, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    try {
      const { result } = await runSample({
        phase: { id: "serial" },
        coldWarm: "cold",
        iteration: 1,
        childIndex: 0,
        subject,
        root,
        sharedEnv: {},
        runtimeTelemetry: {},
        verifiedSubjectSha: APPROVED_TARGET_SHA,
        runOperation: async (command: string, args: string[]) => {
          calls.push([command, ...args].join(" "));
          return {
            code: null,
            signal: null,
            error: "timeout",
            timedOut: true,
            incomplete: true,
            cleanup: { terminationObserved: false },
          };
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`${packageManagerCommand()} install`);
      expect(calls.join("\n")).not.toContain("run build");
      expect(result).toMatchObject({
        incomplete: true,
        build: { skipped: true, reason: expect.stringMatching(/install/i) },
        probe: { skipped: true, reason: expect.stringMatching(/install/i) },
      });
      expect(existsSync(result.stdoutPath)).toBe(true);
      expect(existsSync(result.stderrPath)).toBe(true);
      expect(readFileSync(result.stdoutPath, "utf8")).toBe("");
      expect(readFileSync(result.stderrPath, "utf8")).toBe("");
    } finally {
      rmSync(subject, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bounds and detaches a taskkill child that never settles", async () => {
    const target = Object.assign(new EventEmitter(), {
      pid: 1234,
      kill: () => true,
    });
    const taskkillStdin = Object.assign(new PassThrough(), {
      unrefCalls: 0,
      unref() {
        this.unrefCalls += 1;
      },
    });
    const taskkill = Object.assign(new EventEmitter(), {
      stdin: taskkillStdin,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killCalls: 0,
      unrefCalls: 0,
      kill() {
        this.killCalls += 1;
        return true;
      },
      unref() {
        this.unrefCalls += 1;
      },
    });
    const result = await terminateProcessTree(target, {
      platform: "win32",
      taskkillSettlementWaitMs: 5,
      spawnProcess: () => taskkill,
    });
    expect(result).toMatchObject({
      failed: true,
      taskkillSettlementDeadlineExceeded: true,
      taskkillFinalStrategy: "final-taskkill-kill-and-detach",
    });
    expect(taskkill.killCalls).toBe(1);
    expect(taskkill.unrefCalls).toBe(1);
    expect(taskkill.stdin.destroyed).toBe(true);
    expect(taskkill.stdin.unrefCalls).toBe(1);
    expect(taskkill.stdout.destroyed).toBe(true);
    expect(taskkill.stderr.destroyed).toBe(true);
  });
});

describe("review regressions", () => {
  it("records the exact focused worker bounds in the plan and manifest", () => {
    expect(
      createProbePlan({ iterations: 1, artifactLabel: "wi60495" }).focusedArgs,
    ).toEqual(expect.arrayContaining(["--minWorkers=1", "--maxWorkers=1"]));
    expect(
      createProbeManifestEntry({
        phase: "serial",
        coldWarm: "cold",
        iteration: 1,
        childIndex: 0,
        workspace: ".",
        pnpmStore: ".",
        stdoutPath: "a",
        stderrPath: "b",
      }).command,
    ).toEqual(expect.arrayContaining(["--minWorkers=1", "--maxWorkers=1"]));
  });

  it("rejects a warm sample without the cold workspace reuse", async () => {
    await expect(
      runSample({
        phase: { id: "serial" },
        coldWarm: "warm",
        iteration: 1,
        childIndex: 0,
        subject: ".",
        root: mkdtempSync(join(tmpdir(), "wi60495-")),
        sharedEnv: {},
        runtimeTelemetry: {},
        verifiedSubjectSha: APPROVED_TARGET_SHA,
      }),
    ).rejects.toThrow(/warm sample/i);
  });
});
