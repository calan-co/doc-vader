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
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../..");
const cliPath = path.join(repoRoot, "cli", "doc-vader.ts");
const legacyAdapterPath = path.join(repoRoot, "scripts", "sandcastle", "dv-adapter.ts");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runTsScript(scriptPath: string, args: string[], input?: string): string {
  return execFileSync(process.execPath, ["--import", tsxImport, scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
    ...(input !== undefined ? { input } : {}),
    stdio:
      input === undefined
        ? ["ignore", "pipe", "inherit"]
        : ["pipe", "pipe", "inherit"],
  });
}

function runDv(args: string[]): string {
  return runTsScript(cliPath, args);
}

function runLegacyAdapter(args: string[], input?: string): string {
  return runTsScript(legacyAdapterPath, args, input);
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    fail("Usage: dv4sandcastle <command> [args...]");
  }

  try {
    switch (command) {
      case "list": {
        const payload = await loadSandcastlePlanningListPayload();
        console.log(JSON.stringify(payload, null, 2));
        break;
      }

      case "view": {
        const taskId = args[0] ?? fail("Usage: dv4sandcastle view <task-id>");
        process.stdout.write(runDv(["work", "show", taskId, "--json"]));
        break;
      }

      case "prompt": {
        const taskId = args[0] ?? fail("Usage: dv4sandcastle prompt <task-id>");
        process.stdout.write(runDv(["work", "prompt", taskId]));
        break;
      }

      case "claim-task": {
        const taskId =
          args[0] ?? fail("Usage: dv4sandcastle claim-task <task-id> [claim flags]");
        process.stdout.write(runLegacyAdapter(["claim", taskId, ...args.slice(1)]));
        break;
      }

      case "recover-task": {
        const taskId =
          args[0] ??
          fail("Usage: dv4sandcastle recover-task <task-id> [recover flags]");
        process.stdout.write(runLegacyAdapter(["recover", taskId, ...args.slice(1)]));
        break;
      }

      case "record-task": {
        const input = process.stdin.isTTY ? undefined : readStdin();
        process.stdout.write(runLegacyAdapter(["record", ...args], input));
        break;
      }

      case "close-task": {
        const taskId =
          args[0] ?? fail("Usage: dv4sandcastle close-task <task-id> [close flags]");
        const input = process.stdin.isTTY ? undefined : readStdin();
        process.stdout.write(runLegacyAdapter(["close-task", taskId, ...args.slice(1)], input));
        break;
      }

      case "lock-status": {
        process.stdout.write(runLegacyAdapter(["lock-status", ...args]));
        break;
      }

      default: {
        fail(`Unknown dv4sandcastle command: ${command}`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

main();
