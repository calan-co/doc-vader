#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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

interface PlannerTask {
  id: string;
  number: string;
  title: string;
  summary: string;
  status: string;
  priority: string;
  tags: string[];
  dependencies: string[];
  references: string[];
  file: string;
  bodySections: Array<{ heading: string; excerpt: string }>;
  branch?: string;
  mode: "fresh" | "recovered";
  claimId?: string;
  recovery?: RecoveryMetadata;
}

interface ClaimResult {
  claimId: string;
  taskId: string;
  state: string;
  claim?: JsonRecord;
}

interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: string;
  claim?: JsonRecord;
}

interface ClaimRecoveryReport {
  claimId: string;
  taskId?: string;
  state: string;
  classification: string;
  reasons: string[];
  claim?: JsonRecord;
  git?: JsonRecord;
}

interface RecoveryMetadata {
  classification: string;
  reasons: string[];
  uniqueCommitCount?: number;
  headSha?: string;
  branchExists?: boolean;
}

const MAX_SECTION_EXCERPT_LENGTH = 420;
const RECOVERY_TTL_MINUTES = "240";

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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function bodySectionExcerpts(task: JsonRecord): PlannerTask["bodySections"] {
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
      const bodyText = stringValue(record?.body) ?? stringValue(record?.content);
      return heading && bodyText ? { heading, body: bodyText } : undefined;
    })
    .filter((section): section is { heading: string; body: string } => {
      return typeof section === "object" && section !== null;
    })
    .map((section) => {
      const normalized = section.body.replace(/\s+/g, " ").trim();
      const excerpt =
        normalized.length > MAX_SECTION_EXCERPT_LENGTH
          ? `${normalized.slice(0, MAX_SECTION_EXCERPT_LENGTH - 3)}...`
          : normalized;
      return {
        heading: section.heading,
        excerpt,
      };
    });
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

function toPlannerTask(
  task: JsonRecord,
  options: {
    mode?: "fresh" | "recovered";
    branch?: string;
    claimId?: string;
    recovery?: RecoveryMetadata;
  } = {},
): PlannerTask {
  const id = String(task.id ?? "");
  if (!id) {
    fail("dv task show returned a task without an id.");
  }
  return {
    id: taskNumber(id),
    number: taskNumber(id),
    title: String(task.title ?? id),
    summary: String(task.summary ?? ""),
    status: String(task.status ?? "unknown"),
    priority: String(task.priority ?? "unknown"),
    tags: stringArray(task.tags),
    dependencies: stringArray(task.dependencies),
    references: stringArray(task.references),
    file: String(task.filePath ?? ""),
    bodySections: bodySectionExcerpts(task),
    mode: options.mode ?? "fresh",
    ...(options.branch ? { branch: options.branch } : {}),
    ...(options.claimId ? { claimId: options.claimId } : {}),
    ...(options.recovery ? { recovery: options.recovery } : {}),
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
    "sandcastle"
  );
}

function claimBranch(claim: JsonRecord | undefined): string | undefined {
  const git = recordValue(claim?.git);
  return stringValue(git?.branch) ?? stringValue(claim?.branch);
}

function claimHolderValue(claim: JsonRecord | undefined): string | undefined {
  return stringValue(claim?.holder);
}

function recoveryMetadata(report: ClaimRecoveryReport): RecoveryMetadata {
  const git = recordValue(report.git);
  return {
    classification: report.classification,
    reasons: report.reasons,
    ...(numberValue(git?.uniqueCommitCount) !== undefined
      ? { uniqueCommitCount: numberValue(git?.uniqueCommitCount) }
      : {}),
    ...(stringValue(git?.headSha)
      ? { headSha: stringValue(git?.headSha) }
      : {}),
    ...(typeof git?.branchExists === "boolean"
      ? { branchExists: git.branchExists }
      : {}),
  };
}

function recoverClaim(
  claimId: string,
  action = "inspect",
  holder = process.env.SANDCASTLE_CLAIM_HOLDER ?? "sandcastle",
): ClaimRecoveryReport {
  return json<ClaimRecoveryReport>([
    "task",
    "recover",
    claimId,
    "--action",
    action,
    "--holder",
    holder,
    "--ttl-minutes",
    RECOVERY_TTL_MINUTES,
    "--json",
  ]);
}

function listClaims(): ClaimStatus[] {
  if (runDv(["task", "claim", "--help"]).includes("<task-id>")) {
    console.error(
      "Doc-Vader claim listing is unavailable; continuing with fresh ready tasks only.",
    );
    return [];
  }
  try {
    return json<{ claims: ClaimStatus[] }>(["task", "claim", "--json"]).claims;
  } catch {
    console.error(
      "Doc-Vader claim listing is unavailable; continuing with fresh ready tasks only.",
    );
    return [];
  }
}

function recoverReadyClaims(holder: string): PlannerTask[] {
  const recovered: PlannerTask[] = [];
  for (const status of listClaims()) {
    const branch = claimBranch(status.claim);
    if (!status.taskId || !branch) {
      continue;
    }

    if (status.state === "active") {
      if (claimHolderValue(status.claim) !== holder) {
        continue;
      }
      const task = json<JsonRecord>(["task", "show", status.taskId, "--json"]);
      recovered.push(
        toPlannerTask(task, {
          mode: "recovered",
          branch,
          claimId: status.claimId,
          recovery: {
            classification: "active_sandcastle_claim",
            reasons: ["active_claim_matches_current_holder"],
          },
        }),
      );
      continue;
    }

    if (status.state !== "expired") {
      continue;
    }

    const report = recoverClaim(status.claimId, "inspect", holder);
    if (report.classification === "release_safe") {
      recoverClaim(status.claimId, "release", holder);
      console.error(
        `Released stale claim ${status.claimId} for ${status.taskId}.`,
      );
      continue;
    }
    if (report.classification !== "adopt_recommended") {
      console.error(
        `Skipped stale claim ${status.claimId} for ${status.taskId}: ${report.classification}.`,
      );
      continue;
    }

    const adopted = recoverClaim(status.claimId, "adopt", holder);
    const adoptedBranch =
      stringValue(recordValue(adopted.git)?.branch) ??
      stringValue(recordValue(report.git)?.branch) ??
      branch;
    const task = json<JsonRecord>(["task", "show", status.taskId, "--json"]);
    recovered.push(
      toPlannerTask(task, {
        mode: "recovered",
        branch: adoptedBranch,
        claimId: adopted.claimId,
        recovery: recoveryMetadata(report),
      }),
    );
    console.error(
      `Adopted stale claim ${status.claimId} for ${status.taskId}.`,
    );
  }
  return recovered;
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

  const expired = listClaims().find((status) => {
    return (
      status.taskId === `wi-${taskNumber(taskId)}` &&
      status.state === "expired" &&
      (!requestedBranch || claimBranch(status.claim) === requestedBranch)
    );
  });
  if (expired) {
    const report = recoverClaim(expired.claimId, "inspect", holder);
    if (report.classification === "adopt_recommended") {
      console.log(
        JSON.stringify(recoverClaim(expired.claimId, "adopt", holder), null, 2),
      );
      return;
    }
    if (report.classification === "release_safe") {
      recoverClaim(expired.claimId, "release", holder);
    }
  }

  process.stdout.write(
    runDv(["task", "claim", taskId, "--json", ...args.slice(1)]),
  );
}

function closeTask(taskId: string, args: string[]): void {
  const claim = json<ClaimResult>(["task", "claim-for", taskId, "--json"]);
  const closeArgs = hasOption(args, "--reason")
    ? args
    : ["--reason", "completed", ...args];
  const closed = json<JsonRecord>([
    "task",
    "close",
    "--claim",
    claim.claimId,
    "--json",
    ...closeArgs,
  ]);
  const released = json<JsonRecord>([
    "task",
    "release",
    "--claim",
    claim.claimId,
    "--json",
  ]);
  console.log(
    JSON.stringify(
      {
        taskId,
        claim,
        closed,
        released,
      },
      null,
      2,
    ),
  );
}

function releaseTask(taskId: string): void {
  const claim = json<ClaimResult>(["task", "claim-for", taskId, "--json"]);
  const released = json<JsonRecord>([
    "task",
    "release",
    "--claim",
    claim.claimId,
    "--json",
  ]);
  console.log(
    JSON.stringify(
      {
        taskId,
        claim,
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
      const holder = process.env.SANDCASTLE_CLAIM_HOLDER ?? "sandcastle";
      const recovered = recoverReadyClaims(holder);
      const ready = json<{ candidates: Array<{ id: string }> }>([
        "task",
        "ready",
        "--json",
        "--candidates-only",
      ]);
      const recoveredIds = new Set(recovered.map((task) => task.id));
      const tasks = [
        ...recovered,
        ...ready.candidates
          .filter((candidate) => !recoveredIds.has(taskNumber(candidate.id)))
          .map((candidate) => {
            const id = taskNumber(candidate.id);
            return toPlannerTask(
              json<JsonRecord>(["task", "show", candidate.id, "--json"]),
              {
                mode: "fresh",
                branch: `sandcastle/issue-${id}`,
              },
            );
          }),
      ];
      console.log(JSON.stringify(tasks, null, 2));
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
      process.stdout.write(runDv(["task", "transition", "--json", ...args]));
      return;
    }
    case "close": {
      process.stdout.write(runDv(["task", "close", "--json", ...args]));
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
      process.stdout.write(runDv(["task", "release", "--json", ...args]));
      return;
    }
    default:
      fail(
        "Usage: dv-adapter.ts <list|view|prompt|claim|record|transition|close|close-task|release-task|release> ...",
      );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
