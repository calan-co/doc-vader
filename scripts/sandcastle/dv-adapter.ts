#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ClaimReleaseContext,
  formatClaimReleaseMessage,
  formatGenericClaimReleaseMessage,
} from "./claim-release.js";
import { loadSandcastlePlanningListPayload } from "../../lib/sandcastle/planning-list.js";
import {
  openRuntimeSqliteStore,
  type RuntimeClaimRecord,
} from "../../lib/runtime/index.js";
import {
  collectBranchDiffPaths,
  collectChangedPaths,
} from "../../lib/task/recovery-state.js";

type JsonRecord = Record<string, unknown>;
type RuntimeStore = ReturnType<typeof openRuntimeSqliteStore>;
type RuntimeClaimReleaseResult = JsonRecord & { claimToken: string };
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const adapterRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DEFAULT_CONSUMER_CONFIG_PATH = ".doc-vader/backlog-consumer.json";
const DEFAULT_BACKLOG_DIR = "backlog";
const DEFAULT_CLOSE_RECORD_TYPE = "test-result";

interface AdapterTask {
  id: string;
  number: string;
  title: string;
  summary?: string;
  body: string;
  status: string;
  lifecycle?: string;
  state: "open" | "closed";
  priority?: string;
  tags: string[];
  references: string[];
  dependencies: JsonRecord[];
  relationships?: JsonRecord[];
  records?: JsonRecord[];
  activeLocks?: JsonRecord[];
  file: string;
  bodySections: Array<{ heading: string; content: string }>;
  frontmatter: JsonRecord;
  canonicalTask: JsonRecord;
}

interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: string;
  claim?: JsonRecord;
}

interface AdapterCloseRecordPreview {
  type: string;
  payloadRaw: string;
  payload: JsonRecord;
  preview: {
    id: string;
    filePath: string;
  };
  evidenceLink: string;
  relativeFilePath: string;
}

interface TransitionScriptInvocationResult {
  path: string;
  lockPaths: string[];
  output: JsonRecord;
}

interface CloseCommandSettings {
  actual?: string;
  completedDate: string;
  consumerConfigPath: string;
  backlogDir: string;
  recordType: string;
  payloadPath?: string;
  passThroughArgs: string[];
  taskContextArgs: string[];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function repoRoot(): string {
  return process.cwd();
}

function dvArgs(args: string[]): [string, string[]] {
  const distCli = path.resolve(adapterRootDir, "dist/cli/doc-vader.js");
  if (process.env.DOC_VADER_ADAPTER_USE_DIST === "true" && existsSync(distCli)) {
    return ["node", [distCli, ...args]];
  }
  return [
    "node",
    ["--import", tsxImport, path.resolve(adapterRootDir, "cli/doc-vader.ts"), ...args],
  ];
}

function runDv(args: string[], input?: string): string {
  const [command, commandArgs] = dvArgs(args);
  return execFileSync(command, commandArgs, {
    cwd: repoRoot(),
    encoding: "utf8",
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
    input,
    stdio:
      input === undefined
        ? ["ignore", "pipe", "inherit"]
        : ["pipe", "pipe", "inherit"],
  });
}

function json<T>(args: string[], input?: string): T {
  return JSON.parse(runDv(args, input)) as T;
}

function taskNumber(taskId: string): string {
  return taskId.replace(/^wi-/, "");
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    const record = recordValue(item);
    const target = stringValue(record?.target);
    if (target) {
      return [target];
    }
    const id = stringValue(record?.id);
    if (id) {
      return [id];
    }
    return [];
  });
}

function recordValue(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return hasText(value) ? value.trim() : undefined;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = recordValue(entry);
    return record ? [record] : [];
  });
}

function taskBodySections(task: JsonRecord): Array<{ heading: string; content: string }> {
  const body = recordValue(task.body);
  const sections = Array.isArray(task.bodySections)
    ? task.bodySections
    : body?.sections;
  if (!Array.isArray(sections)) {
    return [];
  }
  return sections
    .map((section) => {
      const record = recordValue(section);
      const heading = stringValue(record?.heading) ?? stringValue(record?.title);
      const content = stringValue(record?.body) ?? stringValue(record?.content);
      return heading && content ? { heading, content } : undefined;
    })
    .filter((section): section is { heading: string; content: string } => {
      return section !== undefined;
    });
}

function taskValidation(task: JsonRecord): JsonRecord | undefined {
  return recordValue(task.validation);
}

function taskReferences(task: JsonRecord): string[] {
  const validation = taskValidation(task);
  const links = recordValue(validation?.links);
  return stringArray(links?.reference);
}

function taskFrontmatter(task: JsonRecord): JsonRecord {
  const validation = taskValidation(task);
  const frontmatter: JsonRecord = {
    id: task.id,
    title: task.title,
    status: task.status,
    lifecycle: task.lifecycle,
    type: validation?.type,
  };
  const optionalEntries: Array<[string, unknown]> = [
    ["summary", task.summary],
    ["subtype", validation?.subtype],
    ["priority", validation?.priority],
    ["estimated", task.estimated],
    ["actual", task.actual],
    ["status_reason", validation?.statusReason],
    ["$schema", validation?.schema],
    ["$content_schema", validation?.contentSchema],
    ["$template", validation?.template],
    ["links", validation?.links],
    ["tags", task.tags],
  ];
  for (const [key, value] of optionalEntries) {
    if (value !== undefined) {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function taskState(status: string): AdapterTask["state"] {
  return status === "completed" || status === "aborted" ? "closed" : "open";
}

function isoDateOnly(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function currentChangedPaths(): string[] {
  const changed = new Set(
    collectBranchDiffPaths(repoRoot()).map((entry) => asRelativeRepoPath(entry)),
  );
  for (const entry of collectChangedPaths(repoRoot())) {
    changed.add(asRelativeRepoPath(entry.path));
  }
  return [...changed];
}

function taskBody(task: JsonRecord): string {
  return taskBodySections(task)
    .map((section) => `## ${section.heading}\n\n${section.content}`.trim())
    .join("\n\n");
}

function toAdapterTask(task: JsonRecord, showText = taskBody(task)): AdapterTask {
  const id = String(task.id ?? "");
  if (!id) {
    fail("dv work show returned a work item without an id.");
  }
  const status = String(task.status ?? "unknown");
  const validation = taskValidation(task);
  const summary = task.summary;
  const lifecycle = task.lifecycle;
  const priority = validation?.priority;
  const dependencies = recordArray(task.dependencies);
  const relationships = recordArray(task.relationships);
  const records = recordArray(task.records);
  const activeLocks = recordArray(task.activeLocks);
  return {
    id: taskNumber(id),
    number: taskNumber(id),
    title: String(task.title ?? id),
    ...(hasText(summary) ? { summary } : {}),
    body: showText,
    status,
    ...(hasText(lifecycle) ? { lifecycle } : {}),
    state: taskState(status),
    ...(hasText(priority) ? { priority } : {}),
    tags: stringArray(task.tags),
    references: taskReferences(task),
    dependencies,
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(records.length > 0 ? { records } : {}),
    ...(activeLocks.length > 0 ? { activeLocks } : {}),
    file: String(task.filePath ?? ""),
    bodySections: taskBodySections(task),
    frontmatter: taskFrontmatter(task),
    canonicalTask: task,
  };
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

function readTextFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function hasOption(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`),
  );
  if (index < 0) {
    return undefined;
  }
  const token = args[index]!;
  return token.startsWith(`${name}=`)
    ? token.slice(name.length + 1)
    : args[index + 1];
}

function stripOption(args: string[], name: string): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === name) {
      index += 1;
      continue;
    }
    if (token.startsWith(`${name}=`)) {
      continue;
    }
    stripped.push(token);
  }
  return stripped;
}

function ensureOption(args: string[], name: string): string[] {
  return hasOption(args, name) ? args : [...args, name];
}

function claimHolder(args: string[]): string {
  return (
    optionValue(args, "--holder") ??
    process.env.SANDCASTLE_CLAIM_HOLDER ??
    "sandcastle:manual"
  );
}

function asRelativeRepoPath(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(repoRoot(), filePath);
  const relativePath = path.relative(repoRoot(), absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    fail(`Path '${filePath}' must resolve inside the repository root.`);
  }
  return relativePath.split(path.sep).join("/");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readTextFile(filePath)) as T;
}

function parseJsonRecord(value: string, errorPrefix: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    const record = recordValue(parsed);
    if (!record) {
      throw new Error("expected a JSON object");
    }
    return record;
  } catch (error) {
    fail(
      `${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function closeCommandSettings(args: string[]): CloseCommandSettings {
  const consumerConfigPath = optionValue(args, "--consumer-config");
  const backlogDir = optionValue(args, "--backlog-dir");
  const forwarded: string[] = [];
  if (consumerConfigPath) {
    forwarded.push("--consumer-config", consumerConfigPath);
  }
  if (backlogDir) {
    forwarded.push("--backlog-dir", backlogDir);
  }
  return {
    actual: optionValue(args, "--actual"),
    completedDate: optionValue(args, "--completed-date") ?? isoDateOnly(),
    consumerConfigPath: consumerConfigPath ?? DEFAULT_CONSUMER_CONFIG_PATH,
    backlogDir: backlogDir ?? DEFAULT_BACKLOG_DIR,
    recordType: optionValue(args, "--record-type") ?? DEFAULT_CLOSE_RECORD_TYPE,
    payloadPath: optionValue(args, "--payload"),
    passThroughArgs: forwarded,
    taskContextArgs: backlogDir ? ["--backlog-dir", backlogDir] : [],
  };
}

function resolveCloseClaim(taskId: string, args: string[]): ClaimStatus {
  const explicitClaimId = optionValue(args, "--claim");
  if (explicitClaimId) {
    return withRuntimeStore((store) => {
      const claim = store.getClaimByToken(explicitClaimId);
      if (!claim || claim.target_type !== "task") {
        fail(`No active runtime task claim found for ${explicitClaimId}.`);
      }
      if (claim.target_id !== taskId) {
        fail(
          `Runtime claim '${explicitClaimId}' does not belong to task '${taskId}'.`,
        );
      }
      if (claim.state !== "active") {
        fail(`Runtime claim '${explicitClaimId}' is not active.`);
      }
      return runtimeClaimStatus(claim);
    });
  }

  const holder = claimHolder(args);
  const claims = activeRuntimeClaimsForTask(taskId, holder);
  if (claims.length === 1) {
    return claims[0]!;
  }
  if (claims.length === 0) {
    fail(
      `Task '${taskId}' has no active runtime claim. Pass --claim or claim the task first.`,
    );
  }
  fail(
    `Task '${taskId}' has multiple active runtime claims. Pass --claim to choose one explicitly.`,
  );
}

function resolveClosePayload(
  settings: CloseCommandSettings,
): AdapterCloseRecordPreview | undefined {
  const { payloadPath } = settings;
  if (!payloadPath) {
    return undefined;
  }
  const payloadRaw =
    payloadPath === "-"
      ? readStdin()
      : readTextFile(path.resolve(repoRoot(), payloadPath));
  const payload = parseJsonRecord(
    payloadRaw,
    "Close record payload must be valid JSON",
  );
  const preview = json<JsonRecord>(
    [
      "record",
      "create",
      "--type",
      settings.recordType,
      "--payload",
      "-",
      "--dry-run",
      "--json",
      ...settings.passThroughArgs,
    ],
    payloadRaw,
  );
  const filePath = stringValue(preview.filePath);
  const id = stringValue(preview.id);
  if (!filePath || !id) {
    fail("Record preview did not return a file path and id.");
  }
  return {
    type: settings.recordType,
    payloadRaw,
    payload,
    preview: {
      id,
      filePath,
    },
    evidenceLink: `[[${path.basename(filePath, ".md")}]]`,
    relativeFilePath: asRelativeRepoPath(filePath),
  };
}

function configuredTransitionScript(consumerConfigPath: string): string | undefined {
  const resolvedConfigPath = path.resolve(repoRoot(), consumerConfigPath);
  if (!existsSync(resolvedConfigPath)) {
    return undefined;
  }
  const config = readJsonFile<JsonRecord>(resolvedConfigPath);
  const automation = recordValue(config.automation);
  const sandcastle = recordValue(automation?.sandcastle) ?? recordValue(config.sandcastle);
  const close = recordValue(sandcastle?.close);
  const direct = stringValue(close?.transitionScript);
  if (direct) {
    return direct;
  }
  const scriptRecord = recordValue(close?.transitionScript);
  return stringValue(scriptRecord?.path);
}

function transitionScriptCommand(scriptPath: string): [string, string[]] {
  const resolvedPath = path.resolve(repoRoot(), scriptPath);
  if (!existsSync(resolvedPath)) {
    fail(`Configured Sandcastle transition script not found: ${scriptPath}`);
  }
  if (/\.(cts|mts|ts)$/i.test(resolvedPath)) {
    return ["node", ["--import", tsxImport, resolvedPath]];
  }
  return ["node", [resolvedPath]];
}

function runTransitionScript(options: {
  scriptPath: string;
  mode: "plan" | "apply";
  task: AdapterTask;
  claim: ClaimStatus;
  settings: CloseCommandSettings;
  record?: AdapterCloseRecordPreview;
}): TransitionScriptInvocationResult {
  const [command, commandArgs] = transitionScriptCommand(options.scriptPath);
  const input = JSON.stringify(
    {
      mode: options.mode,
      task: {
        id: normalizeTaskId(options.task.id),
        number: options.task.number,
        title: options.task.title,
        filePath: options.task.file,
        status: options.task.status,
      },
      claim: {
        claimToken: options.claim.claimId,
        taskId: options.claim.taskId,
        state: options.claim.state,
        claim: options.claim.claim,
      },
      close: {
        actual: options.settings.actual,
        completedDate: options.settings.completedDate,
        consumerConfig: options.settings.consumerConfigPath,
        backlogDir: options.settings.backlogDir,
      },
      ...(options.record
        ? {
            record: {
              type: options.record.type,
              evidenceLink: options.record.evidenceLink,
              payload: options.record.payload,
              preview: {
                id: options.record.preview.id,
                filePath: options.record.relativeFilePath,
              },
            },
          }
        : {}),
    },
    null,
    2,
  );
  const output = execFileSync(command, commandArgs, {
    cwd: repoRoot(),
    encoding: "utf8",
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const parsed =
    output.trim().length === 0
      ? {}
      : parseJsonRecord(output, "Transition script output must be valid JSON");
  return {
    path: asRelativeRepoPath(path.resolve(repoRoot(), options.scriptPath)),
    lockPaths: uniquePaths(stringArray(parsed.lockPaths)),
    output: parsed,
  };
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((entry) => asRelativeRepoPath(entry)))];
}

function claimBranch(claim: JsonRecord | undefined): string | undefined {
  const metadata = recordValue(claim?.metadata);
  const git = recordValue(claim?.git) ?? recordValue(metadata?.git);
  return (
    stringValue(metadata?.branch) ??
    stringValue(git?.branch) ??
    stringValue(claim?.branch)
  );
}

function branchExists(branch: string): boolean {
  return git(["rev-parse", "--verify", branch]) !== undefined;
}

function branchUniqueCommitCount(branch: string): number {
  const count = git(["rev-list", "--count", `HEAD..${branch}`])?.trim();
  return Number(count) || 0;
}

function describeClaimRelease(
  claim: ClaimStatus,
  context: ClaimReleaseContext,
): string {
  const taskId = claim.taskId ?? "unknown task";
  const branch = claimBranch(claim.claim);
  const releaseDetails = { taskId, branch };

  if (context !== "no-commit") {
    return formatClaimReleaseMessage(releaseDetails, context);
  }

  if (!branch || !branchExists(branch) || branchUniqueCommitCount(branch) > 0) {
    return formatGenericClaimReleaseMessage(releaseDetails);
  }

  return formatClaimReleaseMessage(releaseDetails, context);
}

function normalizeTaskId(taskId: string): string {
  return taskId.startsWith("wi-") ? taskId : `wi-${taskNumber(taskId)}`;
}

function withRuntimeStore<T>(
  callback: (store: RuntimeStore) => T,
): T {
  const store = openRuntimeSqliteStore({ rootDir: repoRoot() });
  try {
    return callback(store);
  } finally {
    store.close();
  }
}

function runtimeClaimStatus(claim: RuntimeClaimRecord): ClaimStatus {
  return {
    claimId: claim.claim_token,
    taskId: claim.target_id,
    state: claim.state,
    claim: claim as unknown as JsonRecord,
  };
}

function activeRuntimeClaimsForTask(taskId: string, holder?: string): ClaimStatus[] {
  const normalizedTaskId = normalizeTaskId(taskId);
  return withRuntimeStore((store) =>
    store
      .listClaims()
      .filter((claim) => {
        return (
          claim.target_type === "task" &&
          claim.target_id === normalizedTaskId &&
          claim.state === "active" &&
          (!holder || claim.holder === holder)
        );
      })
      .map(runtimeClaimStatus),
  );
}

function runClaimRelease(
  claimId: string,
  args: string[],
): string {
  return runDv(["claim", "release", claimId, ...ensureOption(args, "--json")]);
}

function failJson(
  code: string,
  message: string,
  payload: Record<string, unknown>,
): never {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: {
          code,
          message,
          ...payload,
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function assertSandcastleSelectable(
  taskId: string,
  args: string[],
): Promise<void> {
  const payload = await loadSandcastlePlanningListPayload();
  const normalizedTaskId = normalizeTaskId(taskId);
  const selectedId = taskNumber(normalizedTaskId);
  if (payload.selectable.some((entry) => entry.id === selectedId)) {
    return;
  }

  const horizon = payload.horizon.find((entry) => entry.id === selectedId);
  const reasonCodes = horizon?.reasonCodes ?? ["not_selectable"];
  const message = `Task '${normalizedTaskId}' is not selectable for Sandcastle claim.`;
  if (hasOption(args, "--json")) {
    failJson("DV4SANDCASTLE_NOT_SELECTABLE", message, {
      taskId: normalizedTaskId,
      reasonCodes,
    });
  }
  fail(`${message} Reasons: ${reasonCodes.join(", ")}.`);
}

async function claimTask(taskId: string, args: string[]): Promise<void> {
  const normalizedTaskId = normalizeTaskId(taskId);
  const holder = claimHolder(args);
  const requestedBranch = optionValue(args, "--branch");
  const existing = activeRuntimeClaimsForTask(normalizedTaskId, holder).find(
    (status) =>
      !requestedBranch || claimBranch(status.claim) === requestedBranch,
  );
  if (existing) {
    console.log(
      JSON.stringify(
        {
          claimId: existing.claimId,
          claimToken: existing.claimId,
          taskId: existing.taskId,
          state: existing.state,
          claim: existing.claim,
          idempotent: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  await assertSandcastleSelectable(normalizedTaskId, args);
  process.stdout.write(
    runDv(["work", "claim", normalizedTaskId, "--json", ...args.slice(1)]),
  );
}

async function closeTask(taskId: string, args: string[]): Promise<void> {
  const normalizedTaskId = normalizeTaskId(taskId);
  const settings = closeCommandSettings(args);
  const task = toAdapterTask(
    json<JsonRecord>([
      "work",
      "show",
      normalizedTaskId,
      "--json",
      ...settings.taskContextArgs,
    ]),
  );
  const claim = resolveCloseClaim(normalizedTaskId, args);
  const record = resolveClosePayload(settings);
  const transitionScriptPath = configuredTransitionScript(
    settings.consumerConfigPath,
  );
  const transitionPlan = transitionScriptPath
    ? runTransitionScript({
        scriptPath: transitionScriptPath,
        mode: "plan",
        task,
        claim,
        settings,
        record,
      })
    : undefined;
  const lockPaths = uniquePaths([
    ...currentChangedPaths(),
    task.file,
    ...(record ? [record.relativeFilePath] : []),
    ...(transitionPlan?.lockPaths ?? []),
  ]);

  const preReleaseTaskSnapshot = task.file
    ? readTextFile(path.resolve(repoRoot(), task.file))
    : undefined;
  try {
    if (lockPaths.length > 0) {
      runDv(["lock", "create", "--claim", claim.claimId, ...lockPaths, "--json"]);
    }

    const recorded = record
      ? json<JsonRecord>(
          [
            "work",
            "record",
            "--claim",
            claim.claimId,
            "--type",
            record.type,
            "--payload",
            "-",
            "--json",
            ...settings.passThroughArgs,
          ],
          record.payloadRaw,
        )
      : undefined;

    const appliedScript = transitionScriptPath
      ? runTransitionScript({
          scriptPath: transitionScriptPath,
          mode: "apply",
          task,
          claim,
          settings,
          record,
        })
      : undefined;

    const validation = json<JsonRecord>(
      [
        "claim",
        "release",
        claim.claimId,
        "--outcome",
        "success",
        "--dry-run",
        "--json",
        ...settings.passThroughArgs,
      ],
    );

    const release = json<JsonRecord>(
      [
        "claim",
        "release",
        claim.claimId,
        "--outcome",
        "success",
        "--json",
        ...settings.passThroughArgs,
      ],
    );

    console.error(describeClaimRelease(claim, "post-merge"));
    console.log(
      JSON.stringify(
        {
          taskId: normalizedTaskId,
          claimToken: claim.claimId,
          lockPaths,
          ...(recorded ? { record: recorded } : {}),
          ...(transitionPlan
            ? {
                transitionScript: {
                  path: transitionPlan.path,
                  lockPaths: transitionPlan.lockPaths,
                  ...(Object.keys(appliedScript?.output ?? {}).length > 0
                    ? { output: appliedScript?.output }
                    : {}),
                },
              }
            : {}),
          validation,
          release,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (preReleaseTaskSnapshot && task.file) {
      try {
        writeFileSync(
          path.resolve(repoRoot(), task.file),
          preReleaseTaskSnapshot,
          "utf8",
        );
      } catch {
        // Best-effort task rollback only.
      }
    }
    try {
      runDv([
        "claim",
        "release",
        claim.claimId,
        "--outcome",
        "invalid",
        "--code",
        "x-sandcastle-close-failed",
        "--message",
        error instanceof Error ? error.message : String(error),
        "--json",
      ]);
    } catch {
      // Best-effort runtime halt only.
    }
    throw error;
  }
}

function releaseTask(taskId: string, args: string[]): void {
  const explicitClaimId = optionValue(args, "--claim");
  const holder = optionValue(args, "--holder") ?? process.env.SANDCASTLE_CLAIM_HOLDER;
  const claims = explicitClaimId
    ? [
        withRuntimeStore((store) => {
          const claim = store.getClaimByToken(explicitClaimId);
          if (!claim || claim.target_type !== "task") {
            fail(`No active runtime task claim found for ${explicitClaimId}.`);
          }
          if (claim.target_id !== normalizeTaskId(taskId)) {
            fail(
              `Runtime claim '${explicitClaimId}' does not belong to task '${normalizeTaskId(taskId)}'.`,
            );
          }
          if (claim.state !== "active") {
            fail(`Runtime claim '${explicitClaimId}' is not active.`);
          }
          return runtimeClaimStatus(claim);
        }),
      ]
    : activeRuntimeClaimsForTask(taskId, holder);
  if (!holder && !explicitClaimId && claims.length > 1) {
    fail(
      `Task '${normalizeTaskId(taskId)}' has multiple active runtime claims. Pass --claim or --holder.`,
    );
  }
  if (claims.length === 0) {
    fail(
      `Task '${normalizeTaskId(taskId)}' has no active runtime claim. Pass --claim or claim the task first.`,
    );
  }
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const forwardedArgs = ensureOption(
    hasOption(args, "--outcome")
      ? stripOption(stripOption(args, "--claim"), "--holder")
      : [
          "--outcome",
          "cancelled",
          ...stripOption(stripOption(args, "--claim"), "--holder"),
        ],
    "--json",
  );
  const released = claims.map((claim) => {
    const output = runClaimRelease(claim.claimId, forwardedArgs);
    return JSON.parse(output) as RuntimeClaimReleaseResult;
  });
  for (const claim of released) {
    const claimStatus = claimById.get(claim.claimToken);
    if (claimStatus) {
      console.error(describeClaimRelease(claimStatus, "no-commit"));
    }
  }
  console.log(
    JSON.stringify(
      {
        taskId: normalizeTaskId(taskId),
        released,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "list": {
      const payload = await loadSandcastlePlanningListPayload();
      console.log(JSON.stringify(payload.selectable, null, 2));
      return;
    }
    case "view": {
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts view <task-id>");
      const showText = runDv(["work", "show", taskId]);
      console.log(
        JSON.stringify(
          toAdapterTask(
            json<JsonRecord>(["work", "show", taskId, "--json"]),
            showText,
          ),
          null,
          2,
        ),
      );
      return;
    }
    case "prompt": {
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts prompt <task-id>");
      process.stdout.write(runDv(["work", "prompt", taskId]));
      return;
    }
    case "claim": {
      const taskId =
        args[0] ??
        fail("Usage: dv-adapter.ts claim <task-id> [dv claim flags]");
      await claimTask(taskId, args);
      return;
    }
    case "record": {
      const hasPayload = hasOption(args, "--payload");
      const payloadValue = optionValue(args, "--payload");
      const payloadArgs = hasPayload ? args : [...args, "--payload", "-"];
      const input =
        !hasPayload || payloadValue === "-" ? readStdin() : undefined;
      process.stdout.write(
        runDv(["work", "record", "--json", ...payloadArgs], input),
      );
      return;
    }
    case "recover": {
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts recover <task-id>");
      process.stdout.write(runDv(["work", "recover", taskId, ...args.slice(1)]));
      return;
    }
    case "lock-status": {
      const claimId =
        optionValue(args, "--claim") ??
        args[0] ??
        fail("Usage: dv-adapter.ts lock-status --claim <claim-id>");
      const forwardedArgs =
        args[0] === claimId && !hasOption(args, "--claim")
          ? args.slice(1)
          : stripOption(args, "--claim");
      process.stdout.write(
        runDv(["lock", "status", "--claim", claimId, ...forwardedArgs]),
      );
      return;
    }
    case "transition": {
      process.stdout.write(runDv(["work-item", "transition", ...args]));
      return;
    }
    case "close": {
      await closeTask(
        args[0] ?? fail("Usage: dv-adapter.ts close <task-id>"),
        args.slice(1),
      );
      return;
    }
    case "close-task": {
      const taskId =
        args[0] ??
        fail("Usage: dv-adapter.ts close-task <task-id> [dv close flags]");
      await closeTask(taskId, args.slice(1));
      return;
    }
    case "release-task": {
      const taskId =
        args[0] ?? fail("Usage: dv-adapter.ts release-task <task-id>");
      releaseTask(taskId, args.slice(1));
      return;
    }
    case "release": {
      const claimId =
        optionValue(args, "--claim") ??
        fail("Usage: dv-adapter.ts release --claim <claim-id>");
      process.stdout.write(runClaimRelease(claimId, stripOption(args, "--claim")));
      return;
    }
    case "halt": {
      const claimId =
        optionValue(args, "--claim") ??
        fail("Usage: dv-adapter.ts halt --claim <claim-id> --reason <reason>");
      const reason =
        optionValue(args, "--reason") ??
        fail("Usage: dv-adapter.ts halt --claim <claim-id> --reason <reason>");
      const forwardedArgs = ensureOption(
        stripOption(stripOption(args, "--claim"), "--reason"),
        "--json",
      );
      process.stdout.write(
        runClaimRelease(claimId, ["--outcome", reason, ...forwardedArgs]),
      );
      return;
    }
    default:
      fail(
        "Usage: dv-adapter.ts <list|view|prompt|claim|record|recover|lock-status|transition|close|close-task|release-task|release|halt> ...",
      );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
