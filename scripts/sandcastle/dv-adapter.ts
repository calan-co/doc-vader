#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

type JsonRecord = Record<string, unknown>;
type RuntimeStore = ReturnType<typeof openRuntimeSqliteStore>;
type RuntimeClaimReleaseResult = JsonRecord & { claimToken: string };
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const adapterRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function taskReferences(task: JsonRecord): string[] {
  const validation = recordValue(task.validation);
  const links = recordValue(validation?.links);
  return stringArray(links?.reference);
}

function taskFrontmatter(task: JsonRecord): JsonRecord {
  const validation = recordValue(task.validation);
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

function toAdapterTask(task: JsonRecord, showText: string): AdapterTask {
  const id = String(task.id ?? "");
  if (!id) {
    fail("dv task show returned a task without an id.");
  }
  const status = String(task.status ?? "unknown");
  const dependencies = recordArray(task.dependencies);
  const relationships = recordArray(task.relationships);
  const records = recordArray(task.records);
  const activeLocks = recordArray(task.activeLocks);
  return {
    id: taskNumber(id),
    number: taskNumber(id),
    title: String(task.title ?? id),
    ...(stringValue(task.summary) ? { summary: String(task.summary) } : {}),
    body: showText,
    status,
    ...(stringValue(task.lifecycle) ? { lifecycle: String(task.lifecycle) } : {}),
    state: status === "completed" || status === "aborted" ? "closed" : "open",
    ...(recordValue(task.validation) && stringValue(recordValue(task.validation)?.priority)
      ? { priority: String(recordValue(task.validation)?.priority) }
      : {}),
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

function completeRuntimeClaimById(claimId: string): ClaimStatus {
  return withRuntimeStore((store) => {
    const claim = store.getClaimByToken(claimId);
    if (!claim || claim.target_type !== "task") {
      fail(`No active runtime task claim found for ${claimId}.`);
    }
    store.completeRuntimeExecution(claimId);
    return {
      claimId: claim.claim_token,
      taskId: claim.target_id,
      state: "completed",
      claim: claim as unknown as JsonRecord,
    };
  });
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

function closeTask(taskId: string, args: string[]): void {
  const normalizedTaskId = normalizeTaskId(taskId);
  const actual = optionValue(args, "--actual");
  if (!actual) {
    fail("Usage: dv-adapter.ts close-task <task-id> --actual <hours>");
  }
  const completedDate = optionValue(args, "--completed-date") ?? isoDateOnly();
  const closeArgs = hasOption(args, "--reason")
    ? args
    : ["--reason", "completed", ...args];
  const transitionOutput = runDv([
    "work-item",
    "transition",
    "--id",
    normalizedTaskId,
    "--status",
    "completed",
    "--completed-date",
    completedDate,
    ...closeArgs,
  ]);
  const released = activeRuntimeClaimsForTask(normalizedTaskId).map((claim) =>
    completeRuntimeClaimById(claim.claimId),
  );
  for (const claim of released) {
    console.error(describeClaimRelease(claim, "post-merge"));
  }
  console.log(
    JSON.stringify(
      {
        taskId: normalizedTaskId,
        transitionOutput,
        released,
      },
      null,
      2,
    ),
  );
}

function releaseTask(taskId: string, args: string[]): void {
  const holder = process.env.SANDCASTLE_CLAIM_HOLDER;
  const claims = activeRuntimeClaimsForTask(taskId, holder);
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const forwardedArgs = ensureOption(
    hasOption(args, "--outcome") ? args : ["--outcome", "cancelled", ...args],
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
      console.log(
        JSON.stringify(await loadSandcastlePlanningListPayload(), null, 2),
      );
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
      closeTask(args[0] ?? fail("Usage: dv-adapter.ts close <task-id>"), args.slice(1));
      return;
    }
    case "close-task": {
      const taskId =
        args[0] ??
        fail("Usage: dv-adapter.ts close-task <task-id> [dv close flags]");
      closeTask(taskId, args.slice(1));
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
