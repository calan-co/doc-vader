#!/usr/bin/env node
/**
 * dv4sandcastle - Wrapper adapter around `dv work` for Sandcastle integration.
 *
 * This is NOT a public CLI command. It's an internal bridge that Sandcastle
 * uses to interact with Doc-Vader's work management through a stable contract.
 *
 * Invoke via: node --import tsx scripts/sandcastle/dv4sandcastle.ts <command> [args...]
 *
 * Commands:
 * - list              -> Sandcastle planning payload over `dv work ready`
 * - view <id>         -> `dv work <id> show --json`
 * - prompt <id>       -> `dv work <id> prompt`
 * - claim-task <id>   -> runtime-aware Sandcastle claim flow
 * - recover-task <id> -> runtime-aware Sandcastle recovery flow
 * - record-task       -> `dv work <id> record`
 * - close-task <id>   -> Sandcastle close flow with transition script support
 * - lock-status       -> runtime lock status for a claim
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSandcastlePlanningListPayload } from "../../lib/sandcastle/planning-list.js";
import {
  formatSandcastleAdapterUsage,
  getSandcastleAdapterCommandContract,
} from "./dv4sandcastle-contract.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.join(repoRoot, "cli", "doc-vader.ts");
const sandcastleAdapterPath = path.join(
  repoRoot,
  "scripts",
  "sandcastle",
  "dv-adapter.ts",
);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireTaskId(
  args: string[],
  commandName:
    | "view"
    | "prompt"
    | "claim-task"
    | "recover-task"
    | "close-task",
): string {
  return args[0] ?? fail(usageFor(commandName));
}

function optionalStdin(): string | undefined {
  return process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
}

function ensureOption(args: string[], name: string): string[] {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
    ? args
    : [...args, name];
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(`${name}=`),
  );
  if (index < 0) {
    return undefined;
  }
  const option = args[index]!;
  return option.startsWith(`${name}=`)
    ? option.slice(name.length + 1)
    : args[index + 1];
}

function runTsScript(scriptPath: string, args: string[], input?: string): string {
  const stdio: ["ignore", "pipe", "inherit"] | ["pipe", "pipe", "inherit"] =
    input === undefined
      ? ["ignore", "pipe", "inherit"]
      : ["pipe", "pipe", "inherit"];
  return execFileSync(process.execPath, ["--import", tsxImport, scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
    ...(input === undefined ? {} : { input }),
    stdio,
  });
}

function runDv(args: string[]): string {
  return runTsScript(cliPath, args);
}

function runSandcastleAdapter(args: string[], input?: string): string {
  return runTsScript(sandcastleAdapterPath, args, input);
}

async function loadSandcastleListPayload() {
  const payload = await loadSandcastlePlanningListPayload();
  return {
    ...payload,
    // The Sandcastle planner treats list entries as selectable work, so keep
    // non-selectable horizon context inside Doc-Vader and adapter tests only.
    horizon: [],
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    fail(formatSandcastleAdapterUsage());
  }

  try {
    switch (command) {
      case "list": {
        const payload = await loadSandcastleListPayload();
        console.log(JSON.stringify(payload, null, 2));
        break;
      }

      case "view": {
        const taskId = requireTaskId(args, "view");
        process.stdout.write(runDv(["work", taskId, "show", "--json"]));
        break;
      }

      case "prompt": {
        const taskId = requireTaskId(args, "prompt");
        process.stdout.write(runDv(["work", taskId, "prompt"]));
        break;
      }

      case "claim-task": {
        const taskId = requireTaskId(args, "claim-task");
        process.stdout.write(runSandcastleAdapter(["claim", taskId, ...args.slice(1)]));
        break;
      }


      case "recover-task": {
        const taskId = requireTaskId(args, "recover-task");
        process.stdout.write(runSandcastleAdapter(["recover", taskId, ...args.slice(1)]));
        break;
      }

      case "record-task": {
        process.stdout.write(runSandcastleAdapter(["record", ...args], optionalStdin()));
        break;
      }

      case "close-task": {
        const taskId = requireTaskId(args, "close-task");
        process.stdout.write(
          runSandcastleAdapter(
            ["close-task", taskId, ...args.slice(1)],
            optionalStdin(),
          ),
        );
        break;
      }

      case "lock-status": {
        process.stdout.write(runSandcastleAdapter(["lock-status", ...args]));
        break;
      }

      default: {
        fail(
          `Unknown dv4sandcastle command: ${command}\n${formatSandcastleAdapterUsage()}`,
        );
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function usageFor(
  commandName:
    | "view"
    | "prompt"
    | "claim-task"
    | "recover-task"
    | "close-task",
): string {
  return `Usage: ${getSandcastleAdapterCommandContract(commandName).usage}`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
