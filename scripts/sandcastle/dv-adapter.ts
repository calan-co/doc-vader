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

interface ClaimResult {
  claimId: string;
  taskId: string;
  state: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function repoRoot(): string {
  return process.cwd();
}

function dvArgs(args: string[]): [string, string[]] {
  const distCli = path.resolve(repoRoot(), "dist/cli/doc-vader.js");
  if (existsSync(distCli)) {
    return ["node", [distCli, ...args]];
  }
  return ["pnpm", ["exec", "tsx", "cli/doc-vader.ts", ...args]];
}

function runDv(args: string[], input?: string): string {
  const [command, commandArgs] = dvArgs(args);
  return execFileSync(command, commandArgs, {
    cwd: repoRoot(),
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
  });
}

function json<T>(args: string[], input?: string): T {
  return JSON.parse(runDv(args, input)) as T;
}

function taskNumber(taskId: string): string {
  return taskId.replace(/^wi-/, "");
}

function taskBody(task: JsonRecord): string {
  const sections = task.bodySections;
  if (!Array.isArray(sections)) {
    return "";
  }
  return sections
    .filter((section): section is { heading: string; body: string } => {
      return (
        typeof section === "object" &&
        section !== null &&
        typeof (section as JsonRecord).heading === "string" &&
        typeof (section as JsonRecord).body === "string"
      );
    })
    .map((section) => `## ${section.heading}\n\n${section.body}`.trim())
    .join("\n\n");
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
    tags: Array.isArray(task.tags) ? task.tags.map(String) : [],
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
  return token.startsWith(`${name}=`) ? token.slice(name.length + 1) : args[index + 1];
}

function closeTask(taskId: string, args: string[]): void {
  const claim = json<ClaimResult>([
    "task",
    "claim-for",
    taskId,
    "--json",
  ]);
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "list": {
      const ready = json<{ candidates: Array<{ id: string }> }>([
        "task",
        "ready",
        "--json",
      ]);
      const tasks = ready.candidates.map((candidate) =>
        toAdapterTask(json<JsonRecord>(["task", "show", candidate.id, "--json"])),
      );
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
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts claim <task-id> [dv claim flags]");
      process.stdout.write(runDv(["task", "claim", taskId, "--json", ...args.slice(1)]));
      return;
    }
    case "record": {
      const hasPayload = hasOption(args, "--payload");
      const payloadValue = optionValue(args, "--payload");
      const payloadArgs = hasPayload ? args : [...args, "--payload", "-"];
      const input =
        !hasPayload || payloadValue === "-" ? readStdin() : undefined;
      process.stdout.write(runDv(["task", "record", "--json", ...payloadArgs], input));
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
      const taskId = args[0] ?? fail("Usage: dv-adapter.ts close-task <task-id> [dv close flags]");
      closeTask(taskId, args.slice(1));
      return;
    }
    case "release": {
      process.stdout.write(runDv(["task", "release", "--json", ...args]));
      return;
    }
    default:
      fail(
        "Usage: dv-adapter.ts <list|view|prompt|claim|record|transition|close|close-task|release> ...",
      );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
