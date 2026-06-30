#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type ClaimReleaseContext,
  formatClaimReleaseMessage,
  formatGenericClaimReleaseMessage,
} from "./claim-release.js";
import { loadSandcastlePlanningListPayload } from "../../lib/sandcastle/planning-list.js";

type JsonRecord = Record<string, unknown>;

interface AdapterTask {
  id: string;
  number: string;
  title: string;
  body: string;
  status: string;
  state: "open" | "closed";
  tags: string[];
  file: string;
  canonicalTask: JsonRecord;
}

interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: string;
  claim?: JsonRecord;
}

interface StoredClaim {
  id: string;
  schemaVersion?: string;
  taskId?: string;
  holder?: string;
  branch?: string;
  sandbox?: string;
  git?: JsonRecord;
  recovery?: JsonRecord;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  releasedAt?: string;
  abandonedAt?: string;
}

interface ClaimStore {
  claims?: StoredClaim[];
}

const RECOVERY_TTL_MINUTES = 240;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function repoRoot(): string {
  return process.cwd();
}

function dvArgs(args: string[]): [string, string[]] {
  const distCli = path.resolve(repoRoot(), "dist/cli/doc-vader.js");
  if (process.env.DOC_VADER_ADAPTER_USE_DIST === "true" && existsSync(distCli)) {
    return ["node", [distCli, ...args]];
  }
  return ["node", ["--import", "tsx", "cli/doc-vader.ts", ...args]];
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

function taskBody(task: JsonRecord): string {
  const body = recordValue(task.body);
  const sections = Array.isArray(task.bodySections)
    ? task.bodySections
    : body?.sections;
  if (!Array.isArray(sections)) {
    return "";
  }
  return sections
    .map((section) => {
      const record = recordValue(section);
      const heading = stringValue(record?.heading) ?? stringValue(record?.title);
      const bodyText = stringValue(record?.body) ?? stringValue(record?.content);
      return heading && bodyText ? { heading, body: bodyText } : undefined;
    })
    .filter((section): section is { heading: string; body: string } => {
      return (
        typeof section === "object" &&
        section !== null
      );
    })
    .map((section) => `## ${section.heading}\n\n${section.body}`.trim())
    .join("\n\n");
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

function toAdapterTask(task: JsonRecord): AdapterTask {
  const id = String(task.id ?? "");
  if (!id) {
    fail("dv task show returned a task without an id.");
  }
  const status = String(task.status ?? "unknown");
  return {
    id: taskNumber(id),
    number: taskNumber(id),
    title: String(task.title ?? id),
    body: taskBody(task),
    status,
    state: status === "completed" || status === "aborted" ? "closed" : "open",
    tags: stringArray(task.tags),
    file: String(task.filePath ?? ""),
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

function claimHolder(args: string[]): string {
  return (
    optionValue(args, "--holder") ??
    process.env.SANDCASTLE_CLAIM_HOLDER ??
    "sandcastle:manual"
  );
}

function claimBranch(claim: JsonRecord | undefined): string | undefined {
  const git = recordValue(claim?.git);
  return stringValue(git?.branch) ?? stringValue(claim?.branch);
}

function claimHolderValue(claim: JsonRecord | undefined): string | undefined {
  return stringValue(claim?.holder);
}

function claimStorePath(): string {
  const configured = process.env.DOC_VADER_TASK_CLAIM_STORE;
  return configured
    ? path.resolve(repoRoot(), configured)
    : path.resolve(repoRoot(), ".doc-vader/runtime/task-claims");
}

function readClaimStore(): ClaimStore {
  const filePath = claimStorePath();
  if (!existsSync(filePath)) {
    return { claims: [] };
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as ClaimStore;
}

function writeClaimStore(store: ClaimStore): void {
  const filePath = claimStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({ ...store, claims: store.claims ?? [] }, null, 2)}\n`,
    "utf8",
  );
}

function storedClaimState(claim: StoredClaim, now = new Date()): string {
  if (claim.releasedAt) {
    return "released";
  }
  if (claim.abandonedAt) {
    return "abandoned";
  }
  if (claim.expiresAt && new Date(claim.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}

function isSandcastleHolder(holder: string | undefined): boolean {
  return holder === "sandcastle" || (holder?.startsWith("sandcastle:") ?? false);
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

function claimIsAdoptable(status: ClaimStatus, branch: string): boolean {
  return (
    isSandcastleHolder(claimHolderValue(status.claim)) &&
    branchExists(branch) &&
    branchUniqueCommitCount(branch) > 0
  );
}

function listClaims(): ClaimStatus[] {
  return (readClaimStore().claims ?? []).map((claim) => ({
    claimId: claim.id,
    taskId: claim.taskId,
    state: storedClaimState(claim),
    claim: claim as unknown as JsonRecord,
  }));
}

function releaseClaimById(claimId: string): ClaimStatus {
  const store = readClaimStore();
  const claims = store.claims ?? [];
  const claim = claims.find((candidate) => candidate.id === claimId);
  if (!claim) {
    fail(`No claim found for ${claimId}.`);
  }
  const releasedAt = new Date().toISOString();
  claim.releasedAt ??= releasedAt;
  claim.updatedAt = releasedAt;
  writeClaimStore({ ...store, claims });
  return {
    claimId: claim.id,
    taskId: claim.taskId,
    state: storedClaimState(claim),
    claim: claim as unknown as JsonRecord,
  };
}

function adoptClaimById(claimId: string, holder: string): ClaimStatus {
  const store = readClaimStore();
  const claims = store.claims ?? [];
  const claim = claims.find((candidate) => candidate.id === claimId);
  if (!claim) {
    fail(`No claim found for ${claimId}.`);
  }
  const adoptedAt = new Date();
  claim.holder = holder;
  claim.updatedAt = adoptedAt.toISOString();
  claim.expiresAt = new Date(
    adoptedAt.getTime() + RECOVERY_TTL_MINUTES * 60 * 1000,
  ).toISOString();
  claim.recovery = {
    ...(recordValue(claim.recovery) ?? {}),
    adoptedAt: adoptedAt.toISOString(),
  };
  writeClaimStore({ ...store, claims });
  return {
    claimId: claim.id,
    taskId: claim.taskId,
    state: storedClaimState(claim),
    claim: claim as unknown as JsonRecord,
  };
}

function activeClaimsForTask(taskId: string, holder?: string): ClaimStatus[] {
  const normalizedTaskId = `wi-${taskNumber(taskId)}`;
  return listClaims().filter((status) => {
    return (
      status.taskId === normalizedTaskId &&
      status.state === "active" &&
      (!holder || claimHolderValue(status.claim) === holder)
    );
  });
}

function idempotentClaim(taskId: string, args: string[]): void {
  const holder = claimHolder(args);
  const requestedBranch = optionValue(args, "--branch");
  const existing = listClaims().find((status) => {
    return (
      status.taskId === `wi-${taskNumber(taskId)}` &&
      status.state === "active" &&
      claimHolderValue(status.claim) === holder &&
      (!requestedBranch || claimBranch(status.claim) === requestedBranch)
    );
  });
  if (existing) {
    console.log(
      JSON.stringify(
        {
          claimId: existing.claimId,
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

  const adoptableActive = listClaims().find((status) => {
    const branch = claimBranch(status.claim);
    return (
      status.taskId === `wi-${taskNumber(taskId)}` &&
      status.state === "active" &&
      (!requestedBranch || branch === requestedBranch) &&
      Boolean(branch && claimIsAdoptable(status, branch))
    );
  });
  if (adoptableActive) {
    console.log(
      JSON.stringify(
        {
          ...adoptClaimById(adoptableActive.claimId, holder),
          adopted: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  const expired = listClaims().find((status) => {
    return (
      status.taskId === `wi-${taskNumber(taskId)}` &&
      status.state === "expired" &&
      (!requestedBranch || claimBranch(status.claim) === requestedBranch)
    );
  });
  if (expired) {
    const branch = claimBranch(expired.claim);
    if (branch && claimIsAdoptable(expired, branch)) {
      console.log(
        JSON.stringify(
          {
            ...adoptClaimById(expired.claimId, holder),
            adopted: true,
          },
          null,
          2,
        ),
      );
      return;
    }
    fail(
      `Claim ${expired.claimId} for wi-${taskNumber(taskId)} is expired and cannot be safely adopted; manual recovery is required before creating a new claim.`,
    );
  }

  process.stdout.write(
    runDv(["task", "claim", taskId, "--json", ...args.slice(1)]),
  );
}

function closeTask(taskId: string, args: string[]): void {
  const normalizedTaskId = `wi-${taskNumber(taskId)}`;
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
  const released = activeClaimsForTask(normalizedTaskId).map((claim) =>
    releaseClaimById(claim.claimId),
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

function releaseTask(taskId: string): void {
  const holder = process.env.SANDCASTLE_CLAIM_HOLDER;
  const claims = activeClaimsForTask(taskId, holder);
  const released = claims.map((claim) => releaseClaimById(claim.claimId));
  for (const claim of released) {
    console.error(describeClaimRelease(claim, "no-commit"));
  }
  console.log(
    JSON.stringify(
      {
        taskId: `wi-${taskNumber(taskId)}`,
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
      console.log(
        JSON.stringify(
          toAdapterTask(json<JsonRecord>(["task", "show", taskId, "--json"])),
          null,
          2,
        ),
      );
      return;
    }
    case "prompt": {
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts prompt <task-id>");
      process.stdout.write(runDv(["task", "prompt", taskId]));
      return;
    }
    case "claim": {
      const taskId =
        args[0] ??
        fail("Usage: dv-adapter.ts claim <task-id> [dv claim flags]");
      idempotentClaim(taskId, args);
      return;
    }
    case "record": {
      const hasPayload = hasOption(args, "--payload");
      const payloadValue = optionValue(args, "--payload");
      const payloadArgs = hasPayload ? args : [...args, "--payload", "-"];
      const input =
        !hasPayload || payloadValue === "-" ? readStdin() : undefined;
      process.stdout.write(
        runDv(["task", "record", "--json", ...payloadArgs], input),
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
      releaseTask(taskId);
      return;
    }
    case "release": {
      const claimId =
        optionValue(args, "--claim") ??
        fail("Usage: dv-adapter.ts release --claim <claim-id>");
      console.log(JSON.stringify(releaseClaimById(claimId), null, 2));
      return;
    }
    case "halt": {
      process.stdout.write(runDv(["claim", "halt", ...args]));
      return;
    }
    default:
      fail(
        "Usage: dv-adapter.ts <list|view|prompt|claim|record|transition|close|close-task|release-task|release|halt> ...",
      );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
