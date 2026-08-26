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
    focusedArgs: [
      "exec",
      "vitest",
      "run",
      "tests/task-command.test.ts",
      "-t",
      TEST_SELECTOR,
      "--pool=forks",
      "--no-file-parallelism",
      "--reporter=verbose",
    ],
    phases: [
      {
        id: "baseline",
        workers: 4,
        iterations: 1,
        coldWarm: ["cold", "warm"],
        fullSuite: true,
      },
      {
        id: "serial",
        workers: 1,
        iterations: inputs.iterations,
        coldWarm: ["cold"],
      },
      {
        id: "two-process",
        workers: 2,
        iterations: inputs.iterations,
        coldWarm: ["cold"],
      },
      {
        id: "four-process",
        workers: 4,
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
    command:
      phase === "baseline"
        ? ["pnpm", "run", "build", "&&", "pnpm", "run", "test", "--", "--run"]
        : [
            "pnpm",
            "exec",
            "vitest",
            "run",
            "tests/task-command.test.ts",
            "-t",
            TEST_SELECTOR,
            "--pool=forks",
            "--maxWorkers=1",
            "--no-file-parallelism",
            "--reporter=verbose",
          ],
    effectiveOptions:
      phase === "baseline"
        ? { VITEST_MAX_WORKERS: "4", minWorkers: 4, maxWorkers: 4 }
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
      runnerOs: process.env.RUNNER_OS ?? process.platform,
      runnerArch: process.env.RUNNER_ARCH ?? process.arch,
      imageOs: process.env.ImageOS ?? "unavailable",
      imageVersion: process.env.ImageVersion ?? "unavailable",
    },
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function run(command, args, { cwd, env, stdoutPath, stderrPath, timeoutMs }) {
  return new Promise((resolveRun) => {
    const startedAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    const stdout = writeFileSync(stdoutPath, "");
    const stderr = writeFileSync(stderrPath, "");
    const stdoutStream = awaitableAppend(stdoutPath);
    const stderrStream = awaitableAppend(stderrPath);
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", (error) =>
      finish({ error: error.message, code: null, signal: null }),
    );
    child.once("close", (code, signal) =>
      finish({ code, signal, error: null }),
    );
    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdoutStream.end();
      stderrStream.end();
      resolveRun({
        ...result,
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
  cpSync(subject, workspace, {
    recursive: true,
    filter: (source) =>
      !["node_modules", ".nx", "dist", "coverage"].includes(basename(source)),
  });
  mkdirSync(pnpmStore, { recursive: true });
  return { workspace, pnpmStore };
}

async function runSample({
  phase,
  coldWarm,
  iteration,
  childIndex,
  subject,
  root,
  sharedEnv,
  runtimeTelemetry,
  reuse,
}) {
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
      ? await run(
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
  const build = await run("pnpm", ["run", "build"], {
    cwd: workspace,
    env,
    stdoutPath: join(sampleRoot, "build.stdout.log"),
    stderrPath: join(sampleRoot, "build.stderr.log"),
    timeoutMs: 20 * 60_000,
  });
  const selected = commandFor(phase);
  const probe =
    build.code === 0
      ? await run(selected.command, selected.args, {
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
  const gitHead = await run("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    env,
    stdoutPath: join(sampleRoot, "git-head.stdout.log"),
    stderrPath: join(sampleRoot, "git-head.stderr.log"),
    timeoutMs: 60_000,
  });
  const result = {
    ...entry,
    install,
    build,
    probe,
    gitHead,
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
  for (const phase of plan.phases) {
    for (let iteration = 1; iteration <= phase.iterations; iteration += 1) {
      const cold = await Promise.all(
        Array.from({ length: phase.workers }, (_, childIndex) =>
          runSample({
            phase,
            coldWarm: "cold",
            iteration,
            childIndex,
            subject,
            root,
            sharedEnv: {},
          }),
        ),
      );
      results.push(...cold.map((sample) => sample.result));
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
              reuse: sample.reuse,
            }),
          ),
        );
        results.push(...warm.map((sample) => sample.result));
      }
    }
  }
  const summary = Object.groupBy(results, (result) => result.phase);
  writeJson(join(root, "summary.json"), {
    targetSha: APPROVED_TARGET_SHA,
    inputs,
    summary,
  });
  writeFileSync(
    join(root, "sha256sums.txt"),
    Object.values(summary)
      .flat()
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
