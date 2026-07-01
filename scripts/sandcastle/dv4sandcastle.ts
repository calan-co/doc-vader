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
 * - view <id>         -> `dv work show <id> --json`
 * - prompt <id>       -> `dv work prompt <id>`
 * - claim-task <id>   -> runtime-aware Sandcastle claim flow
 * - recover-task <id> -> runtime-aware Sandcastle recovery flow
 * - record-task       -> `dv work record`
 * - close-task <id>   -> Sandcastle close flow with transition script support
 * - lock-status       -> runtime lock status for a claim
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSandcastlePlanningListPayload } from "../../lib/sandcastle/planning-list.js";

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

function requireTaskId(args: string[], usage: string): string {
  return args[0] ?? fail(usage);
}

function optionalStdin(): string | undefined {
  return process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
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
    fail("Usage: dv4sandcastle <command> [args...]");
  }

  try {
    switch (command) {
      case "list": {
        const payload = await loadSandcastleListPayload();
        console.log(JSON.stringify(payload, null, 2));
        break;
      }

      case "view": {
        const taskId = requireTaskId(args, "Usage: dv4sandcastle view <task-id>");
        process.stdout.write(runDv(["work", "show", taskId, "--json"]));
        break;
      }

      case "prompt": {
        const taskId = requireTaskId(args, "Usage: dv4sandcastle prompt <task-id>");
        process.stdout.write(runDv(["work", "prompt", taskId]));
        break;
      }

      case "claim-task": {
        const taskId = requireTaskId(
          args,
          "Usage: dv4sandcastle claim-task <task-id> [claim flags]",
        );
        process.stdout.write(runSandcastleAdapter(["claim", taskId, ...args.slice(1)]));
        break;
      }

      case "recover-task": {
        const taskId = requireTaskId(
          args,
          "Usage: dv4sandcastle recover-task <task-id> [recover flags]",
        );
        process.stdout.write(runSandcastleAdapter(["recover", taskId, ...args.slice(1)]));
        break;
      }

      case "record-task": {
        process.stdout.write(runSandcastleAdapter(["record", ...args], optionalStdin()));
        break;
      }

      case "close-task": {
        const taskId = requireTaskId(
          args,
          "Usage: dv4sandcastle close-task <task-id> [close flags]",
        );
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
        fail(`Unknown dv4sandcastle command: ${command}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
