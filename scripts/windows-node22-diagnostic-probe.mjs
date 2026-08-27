#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const APPROVED_TARGET_SHA = "067dff5736754438e1bf8185096c26a9dacebfb1";
const MAX_ITERATIONS = 30;
const MAX_EXECUTION_BUDGET_MS = 330 * 60_000;
const BASELINE_WAVE_BUDGET_MS = 120 * 60_000;
const FOCUSED_WAVE_BUDGET_MS = 55 * 60_000;
const ARTIFACT_LABEL = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEST_SELECTOR =
  "selects ready tasks and reports structured deterministic exclusions|only returns ready candidates that can be claimed in the same context";

export function parseDiagnosticInputs({ iterations, artifactLabel }) {
  const parsedIterations = Number(iterations);
  if (
    !Number.isInteger(parsedIterations) ||
    parsedIterations < 1 ||
    parsedIterations > MAX_ITERATIONS
  ) {
    throw new Error(
      `iterations must be an integer between 1 and ${MAX_ITERATIONS}`,
    );
  }
  if (!ARTIFACT_LABEL.test(artifactLabel)) {
    throw new Error("artifact label must be a safe lowercase slug");
  }
  return { iterations: parsedIterations, artifactLabel };
}

export function createProbePlan({ iterations, artifactLabel }) {
  const inputs = parseDiagnosticInputs({ iterations, artifactLabel });
  return {
    targetSha: APPROVED_TARGET_SHA,
    artifactLabel: inputs.artifactLabel,
    focusedArgs: commandFor({ fullSuite: false }).args,
    phases: [
      {
        id: "baseline",
        processes: 1,
        vitestWorkers: 4,
        iterations: inputs.iterations,
        coldWarm: ["cold", "warm"],
        fullSuite: true,
      },
      {
        id: "serial",
        processes: 1,
        vitestWorkers: 1,
        iterations: inputs.iterations,
        coldWarm: ["cold"],
      },
      {
        id: "two-process",
        processes: 2,
        vitestWorkers: 1,
        iterations: inputs.iterations,
        coldWarm: ["cold"],
      },
      {
        id: "four-process",
        processes: 4,
        vitestWorkers: 1,
        iterations: inputs.iterations,
        coldWarm: ["cold"],
      },
    ],
  };
}

function sha256(path) {
  return existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : "unavailable";
}

export function createProbeManifestEntry({
  phase,
  coldWarm,
  iteration,
  childIndex,
  workspace,
  pnpmStore,
  stdoutPath,
  stderrPath,
  runtimeTelemetry = {},
}) {
  return {
    targetSha: APPROVED_TARGET_SHA,
    phase,
    coldWarm,
    iteration,
    childIndex,
    command: (() => {
      const selected = commandFor({ fullSuite: phase === "baseline" });
      return [selected.command, ...selected.args];
    })(),
    effectiveOptions:
      phase === "baseline"
        ? { pool: "forks", minWorkers: 4, maxWorkers: 4 }
        : {
            pool: "forks",
            minWorkers: 1,
            maxWorkers: 1,
            fileParallelism: false,
          },
    workspace,
    pnpmStore,
    stdoutPath,
    stderrPath,
    lockfileSha256: sha256(join(workspace, "pnpm-lock.yaml")),
    telemetry: {
      nodeVersion: runtimeTelemetry.nodeVersion ?? process.version,
      npmVersion: runtimeTelemetry.npmVersion ?? "unavailable",
      pnpmVersion: runtimeTelemetry.pnpmVersion ?? "unavailable",
      corepackVersion: runtimeTelemetry.corepackVersion ?? "unavailable",
      gitVersion: runtimeTelemetry.gitVersion ?? "unavailable",
      windowsVersion: runtimeTelemetry.windowsVersion ?? "unavailable",
      runnerOs:
        runtimeTelemetry.runnerOs ?? process.env.RUNNER_OS ?? process.platform,
      runnerArch:
        runtimeTelemetry.runnerArch ?? process.env.RUNNER_ARCH ?? process.arch,
      imageOs: runtimeTelemetry.imageOs ?? process.env.ImageOS ?? "unavailable",
      imageVersion:
        runtimeTelemetry.imageVersion ??
        process.env.ImageVersion ??
        "unavailable",
    },
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

export async function terminateProcessTree(
  child,
  {
    platform = process.platform,
    spawnProcess = spawn,
    taskkillSettlementWaitMs = 30_000,
  } = {},
) {
  if (!child?.pid) return { attempted: false, failed: false };
  if (platform !== "win32") {
    child.kill("SIGTERM");
    return { attempted: true, failed: false, fallback: "child.kill(SIGTERM)" };
  }
  return await new Promise((resolveTermination) => {
    const terminator = spawnProcess(
      "taskkill",
      ["/pid", String(child.pid), "/t", "/f"],
      { shell: false, windowsHide: true },
    );
    let settled = false;
    const settlementTimer = setTimeout(() => {
      useFallback(
        null,
        "taskkill settlement deadline elapsed without close or error",
        {
          taskkillSettlementDeadlineExceeded: true,
          ...detachTaskkillChild(terminator),
        },
      );
    }, taskkillSettlementWaitMs);
    const finishTermination = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(settlementTimer);
      resolveTermination(result);
    };
    const useFallback = (taskkillExitCode, taskkillError, details = {}) => {
      let fallbackSucceeded = false;
      let fallbackError;
      try {
        fallbackSucceeded = child.kill("SIGTERM") !== false;
      } catch (error) {
        fallbackError = error instanceof Error ? error.message : String(error);
      }
      finishTermination({
        attempted: true,
        failed: true,
        taskkillExitCode,
        taskkillError,
        fallback: "child.kill(SIGTERM)",
        fallbackSucceeded,
        fallbackError,
        ...details,
      });
    };
    terminator.once("error", (error) => {
      useFallback(null, error instanceof Error ? error.message : String(error));
    });
    terminator.once("close", (code) => {
      if (code === 0) {
        finishTermination({
          attempted: true,
          failed: false,
          taskkillExitCode: 0,
        });
        return;
      }
      useFallback(code, undefined);
    });
  });
}

function closeDetachedStdin(child) {
  try {
    child.stdin?.end?.();
  } catch {
    // Best effort only: final cleanup must not block bounded evidence.
  }
  try {
    child.stdin?.destroy?.();
  } catch {
    // Best effort only: a closed stdin must not block bounded evidence.
  }
  try {
    child.stdin?.unref?.();
  } catch {
    // Best effort only: stdin may not expose an independent handle.
  }
}

function detachTaskkillChild(child) {
  let finalTerminationSucceeded = false;
  try {
    finalTerminationSucceeded = child.kill?.("SIGKILL") !== false;
  } catch {
    finalTerminationSucceeded = false;
  }
  closeDetachedStdin(child);
  try {
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch {
    // Best effort only: taskkill cleanup must not block bounded evidence.
  }
  try {
    child.unref?.();
  } catch {
    // Best effort only: streams are already detached above.
  }
  return {
    taskkillFinalStrategy: finalTerminationSucceeded
      ? "final-taskkill-kill-and-detach"
      : "detach-taskkill-handles",
    taskkillFinalTerminationSucceeded: finalTerminationSucceeded,
  };
}

function detachLiveHandles(child, stdoutStream, stderrStream) {
  let finalTerminationSucceeded = false;
  try {
    finalTerminationSucceeded = child.kill?.("SIGKILL") !== false;
  } catch {
    finalTerminationSucceeded = false;
  }
  closeDetachedStdin(child);
  try {
    child.stdout?.unpipe(stdoutStream);
    child.stderr?.unpipe(stderrStream);
    child.stdout?.destroy();
    child.stderr?.destroy();
    stdoutStream.destroy();
    stderrStream.destroy();
  } catch {
    // Best effort only: safe detachment must not prevent bounded result evidence.
  }
  try {
    child.unref?.();
  } catch {
    // Best effort only: handles are already detached above.
  }
  return {
    finalStrategy: finalTerminationSucceeded
      ? "final-child-kill-and-detach"
      : "detach-live-handles",
    finalTerminationSucceeded,
  };
}

export function shouldStopAfterUnobservedTermination(results) {
  return results.some((result) =>
    [result.install, result.build, result.probe].some(
      (step) => step?.cleanup?.terminationObserved === false,
    ),
  );
}

export function run(
  command,
  args,
  {
    cwd,
    env,
    stdoutPath,
    stderrPath,
    timeoutMs,
    postCleanupWaitMs = 30_000,
    taskkillSettlementWaitMs = 30_000,
    platform = process.platform,
    spawnProcess = spawn,
  },
) {
  return new Promise((resolveRun) => {
    const startedAt = new Date().toISOString();
    let timedOut = false;
    let cleanup = { attempted: false, failed: false };
    let terminationPromise = Promise.resolve();
    let postCleanupTimer;
    const startedNs = process.hrtime.bigint();
    const child = spawnProcess(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    mkdirSync(dirname(stdoutPath), { recursive: true });
    mkdirSync(dirname(stderrPath), { recursive: true });
    writeFileSync(stdoutPath, "");
    writeFileSync(stderrPath, "");
    const stdoutStream = awaitableAppend(stdoutPath);
    const stderrStream = awaitableAppend(stderrPath);
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
    const timer = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminateProcessTree(child, {
        platform,
        spawnProcess,
        taskkillSettlementWaitMs,
      })
        .then((result) => {
          cleanup = result;
        })
        .catch((error) => {
          cleanup = {
            attempted: true,
            failed: true,
            taskkillError:
              error instanceof Error ? error.message : String(error),
          };
        });
      void terminationPromise.then(() => {
        if (done) return;
        postCleanupTimer = setTimeout(() => {
          if (done) return;
          cleanup = {
            ...cleanup,
            failed: true,
            terminationObserved: false,
            postCleanupDeadlineExceeded: true,
            ...detachLiveHandles(child, stdoutStream, stderrStream),
          };
          void finish({
            code: null,
            signal: null,
            error: "post-cleanup deadline elapsed without child close or error",
            incomplete: true,
          });
        }, postCleanupWaitMs);
      });
    }, timeoutMs);
    child.once(
      "error",
      (error) =>
        void finish({ error: error.message, code: null, signal: null }),
    );
    child.once("close", (code, signal) => {
      if (timedOut) {
        cleanup = { ...cleanup, terminationObserved: true };
      }
      void finish({
        code,
        signal,
        error: null,
        terminationObserved: timedOut,
      });
    });
    let done = false;
    async function finish({ terminationObserved = false, ...result }) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(postCleanupTimer);
      await terminationPromise;
      if (terminationObserved) {
        cleanup = { ...cleanup, terminationObserved: true };
      }
      await Promise.all([
        closeWriteStream(stdoutStream),
        closeWriteStream(stderrStream),
      ]);
      resolveRun({
        ...result,
        timedOut,
        cleanup: {
          ...cleanup,
          terminationObserved: cleanup.terminationObserved ?? !timedOut,
        },
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Number(process.hrtime.bigint() - startedNs) / 1e6,
      });
    }
  });
}

function awaitableAppend(path) {
  return createWriteStream(path, { flags: "a" });
}

function closeWriteStream(stream) {
  if (stream.destroyed || stream.writableFinished) return Promise.resolve();
  return new Promise((resolveClose) => {
    stream.once("error", resolveClose);
    stream.end(resolveClose);
  });
}

function commandFor(phase) {
  if (phase.fullSuite)
    return {
      command: "pnpm",
      args: [
        "run",
        "test",
        "--",
        "--run",
        "--pool=forks",
        "--minWorkers=4",
        "--maxWorkers=4",
        "--reporter=verbose",
      ],
      timeoutMs: 25 * 60_000,
    };
  return {
    command: "pnpm",
    args: [
      "exec",
      "vitest",
      "run",
      "tests/task-command.test.ts",
      "-t",
      TEST_SELECTOR,
      "--pool=forks",
      "--minWorkers=1",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--reporter=verbose",
    ],
    timeoutMs: 10 * 60_000,
  };
}

export function shouldCopySubjectPath(source) {
  return (
    !source.split(/[\\/]/).includes(".git") &&
    !["node_modules", ".nx", "dist", "coverage"].includes(basename(source))
  );
}

export function shouldStopForBudget({
  startedAtMs,
  nowMs,
  nextSampleBudgetMs,
}) {
  return nowMs + nextSampleBudgetMs > startedAtMs + MAX_EXECUTION_BUDGET_MS;
}

function prepareWorkspace(subject, root, phase, iteration, childIndex) {
  const workspace = join(
    root,
    "workspaces",
    phase,
    `iteration-${iteration}`,
    `child-${childIndex}`,
  );
  const pnpmStore = join(
    root,
    "stores",
    phase,
    `iteration-${iteration}`,
    `child-${childIndex}`,
  );
  rmSync(workspace, { recursive: true, force: true });
  rmSync(pnpmStore, { recursive: true, force: true });
  cpSync(subject, workspace, {
    recursive: true,
    filter: shouldCopySubjectPath,
  });
  mkdirSync(pnpmStore, { recursive: true });
  return { workspace, pnpmStore };
}

export async function runSample({
  phase,
  coldWarm,
  iteration,
  childIndex,
  subject,
  root,
  sharedEnv,
  runtimeTelemetry,
  verifiedSubjectSha,
  reuse,
  runOperation = run,
}) {
  if (coldWarm === "warm" && !reuse) {
    throw new Error("warm sample requires the preceding cold workspace reuse");
  }
  const prepared =
    reuse ?? prepareWorkspace(subject, root, phase.id, iteration, childIndex);
  const { workspace, pnpmStore } = prepared;
  const sampleRoot = join(
    root,
    "samples",
    phase.id,
    `iteration-${iteration}`,
    `child-${childIndex}`,
    coldWarm,
  );
  mkdirSync(sampleRoot, { recursive: true });
  const env = {
    ...process.env,
    ...sharedEnv,
    RUN_ROOT: root,
    ITERATION: String(iteration),
    TEMP: join(sampleRoot, "temp"),
    TMP: join(sampleRoot, "temp"),
    TMPDIR: join(sampleRoot, "temp"),
    NX_CACHE_DIRECTORY: join(sampleRoot, "nx-cache"),
    DOC_VADER_RUNTIME_DIR: join(sampleRoot, "runtime"),
    PNPM_STORE_DIR: pnpmStore,
  };
  mkdirSync(env.TEMP, { recursive: true });
  const stdoutPath = join(sampleRoot, "stdout.log");
  const stderrPath = join(sampleRoot, "stderr.log");
  writeFileSync(stdoutPath, "");
  writeFileSync(stderrPath, "");
  const entry = createProbeManifestEntry({
    phase: phase.id,
    coldWarm,
    iteration,
    childIndex,
    workspace,
    pnpmStore,
    stdoutPath,
    stderrPath,
    runtimeTelemetry,
  });
  writeJson(join(sampleRoot, "metadata.start.json"), entry);
  const install =
    coldWarm === "cold"
      ? await runOperation(
          "pnpm",
          ["install", "--frozen-lockfile", "--store-dir", pnpmStore],
          {
            cwd: workspace,
            env,
            stdoutPath: join(sampleRoot, "install.stdout.log"),
            stderrPath: join(sampleRoot, "install.stderr.log"),
            timeoutMs: 20 * 60_000,
          },
        )
      : {
          skipped: true,
          reason: "warm sample reuses cold workspace without reinstall",
        };
  const installTerminationUnobserved =
    install?.cleanup?.terminationObserved === false;
  const build = installTerminationUnobserved
    ? {
        skipped: true,
        incomplete: true,
        reason: "install termination was not observed; build was not started",
      }
    : await runOperation("pnpm", ["run", "build"], {
        cwd: workspace,
        env,
        stdoutPath: join(sampleRoot, "build.stdout.log"),
        stderrPath: join(sampleRoot, "build.stderr.log"),
        timeoutMs: 20 * 60_000,
      });
  const selected = commandFor(phase);
  const probe = installTerminationUnobserved
    ? {
        skipped: true,
        incomplete: true,
        reason: "install termination was not observed; probe was not started",
      }
    : build.code === 0
      ? await runOperation(selected.command, selected.args, {
          cwd: workspace,
          env,
          stdoutPath,
          stderrPath,
          timeoutMs: selected.timeoutMs,
        })
      : {
          code: build.code,
          signal: build.signal,
          error: "build failed",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 0,
        };
  const result = {
    ...entry,
    install,
    build,
    probe,
    incomplete: installTerminationUnobserved,
    gitHead: verifiedSubjectSha,
    lockfileSha256: sha256(join(workspace, "pnpm-lock.yaml")),
  };
  writeJson(join(sampleRoot, "metadata.result.json"), result);
  return { result, reuse: prepared };
}
async function collectRuntimeTelemetry(root, subject) {
  const commands = [
    ["nodeVersion", "node", ["--version"]],
    ["npmVersion", "npm", ["--version"]],
    ["pnpmVersion", "pnpm", ["--version"]],
    ["corepackVersion", "corepack", ["--version"]],
    ["gitVersion", "git", ["--version"]],
    [
      "windowsVersion",
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber | Format-List | Out-String).Trim()",
      ],
    ],
  ];
  const telemetry = {};
  for (const [key, command, args] of commands) {
    const stdoutPath = join(root, "environment", `${key}.stdout.log`);
    const stderrPath = join(root, "environment", `${key}.stderr.log`);
    const result = await run(command, args, {
      cwd: subject,
      env: process.env,
      stdoutPath,
      stderrPath,
      timeoutMs: 60_000,
    });
    telemetry[key] =
      result.code === 0 && existsSync(stdoutPath)
        ? readFileSync(stdoutPath, "utf8").trim()
        : "unavailable";
  }
  telemetry.runnerName = process.env.RUNNER_NAME ?? "unavailable";
  telemetry.runnerOs = process.env.RUNNER_OS ?? process.platform;
  telemetry.runnerArch = process.env.RUNNER_ARCH ?? process.arch;
  telemetry.imageOs = process.env.ImageOS ?? "unavailable";
  telemetry.imageVersion = process.env.ImageVersion ?? "unavailable";
  writeJson(join(root, "environment", "runtime.json"), telemetry);
  return telemetry;
}

export function summarizeProbeResults({ plan, results, incomplete }) {
  const rates = {};
  for (const phase of plan.phases) {
    for (const coldWarm of phase.coldWarm) {
      const key = `${phase.id}/${coldWarm}`;
      const matching = results.filter(
        (result) => result.phase === phase.id && result.coldWarm === coldWarm,
      );
      const sampleSteps = (result) => [
        result.install,
        result.build,
        result.probe,
      ];
      const failed = matching.filter((result) =>
        sampleSteps(result).some(
          (step) => step && !step.skipped && (step.timedOut || step.code !== 0),
        ),
      );
      const timedOut = matching.filter((result) =>
        sampleSteps(result).some(
          (step) => step && !step.skipped && step.timedOut,
        ),
      );
      rates[key] = {
        planned: phase.iterations * phase.processes,
        executed: matching.length,
        failed: failed.length,
        timedOut: timedOut.length,
      };
    }
  }
  return { targetSha: APPROVED_TARGET_SHA, incomplete, rates, results };
}

export function waveBudgetForPhase(phase) {
  return phase.fullSuite ? BASELINE_WAVE_BUDGET_MS : FOCUSED_WAVE_BUDGET_MS;
}

async function main() {
  const inputs = parseDiagnosticInputs({
    iterations: process.env.INPUT_ITERATIONS ?? "30",
    artifactLabel: process.env.INPUT_ARTIFACT_LABEL ?? "wi60495-windows-node22",
  });
  const subject = resolve(process.env.SUBJECT_DIR ?? "subject");
  const root = resolve(process.env.ARTIFACT_ROOT ?? "wi60495-diagnostic");
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(subject, "pnpm-lock.yaml")))
    throw new Error(`subject checkout is missing: ${subject}`);
  const target = (
    await run("git", ["rev-parse", "HEAD"], {
      cwd: subject,
      env: process.env,
      stdoutPath: join(root, "subject-head.stdout.log"),
      stderrPath: join(root, "subject-head.stderr.log"),
      timeoutMs: 60_000,
    })
  ).code;
  const head = readFileSync(
    join(root, "subject-head.stdout.log"),
    "utf8",
  ).trim();
  if (target !== 0 || head !== APPROVED_TARGET_SHA)
    throw new Error(
      `subject SHA must be ${APPROVED_TARGET_SHA}; got ${head || "unavailable"}`,
    );
  const runtimeTelemetry = await collectRuntimeTelemetry(root, subject);
  const plan = createProbePlan(inputs);
  writeJson(join(root, "plan.json"), plan);
  const results = [];
  const startedAtMs = Date.now();
  let incomplete = false;
  let incompleteReason = null;
  phaseLoop: for (const phase of plan.phases) {
    for (let iteration = 1; iteration <= phase.iterations; iteration += 1) {
      if (
        shouldStopForBudget({
          startedAtMs,
          nowMs: Date.now(),
          nextSampleBudgetMs: waveBudgetForPhase(phase),
        })
      ) {
        incomplete = true;
        incompleteReason =
          "remaining execution budget prevented the next planned wave";
        break phaseLoop;
      }
      const cold = await Promise.all(
        Array.from({ length: phase.processes }, (_, childIndex) =>
          runSample({
            phase,
            coldWarm: "cold",
            iteration,
            childIndex,
            subject,
            root,
            sharedEnv: {},
            runtimeTelemetry,
            verifiedSubjectSha: head,
          }),
        ),
      );
      const coldResults = cold.map((sample) => sample.result);
      results.push(...coldResults);
      if (shouldStopAfterUnobservedTermination(coldResults)) {
        incomplete = true;
        incompleteReason =
          "unobserved process termination halted later probe waves";
        break phaseLoop;
      }
      if (phase.id === "baseline") {
        const warm = await Promise.all(
          cold.map((sample, childIndex) =>
            runSample({
              phase,
              coldWarm: "warm",
              iteration,
              childIndex,
              subject,
              root,
              sharedEnv: {},
              runtimeTelemetry,
              verifiedSubjectSha: head,
              reuse: sample.reuse,
            }),
          ),
        );
        const warmResults = warm.map((sample) => sample.result);
        results.push(...warmResults);
        if (shouldStopAfterUnobservedTermination(warmResults)) {
          incomplete = true;
          incompleteReason =
            "unobserved process termination halted later probe waves";
          break phaseLoop;
        }
      }
    }
  }
  const summary = summarizeProbeResults({ plan, results, incomplete });
  writeJson(join(root, "summary.json"), {
    ...summary,
    inputs,
    elapsedMs: Date.now() - startedAtMs,
    executionBudgetMs: MAX_EXECUTION_BUDGET_MS,
    incompleteReason,
  });
  writeFileSync(
    join(root, "sha256sums.txt"),
    results
      .map(
        (result) =>
          `${createHash("sha256").update(JSON.stringify(result)).digest("hex")}  ${result.phase}/${result.iteration}/${result.childIndex}/${result.coldWarm}\n`,
      )
      .join(""),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
