#!/usr/bin/env node
/**
 * dv4sandcastle - Wrapper adapter around `dv work` for Sandcastle integration.
 *
 * This is NOT a public CLI command. It's an internal bridge that Sandcastle
 * uses to interact with Doc-Vader's work management through a stable contract.
 *
 * Invoke via: node --import tsx scripts/sandcastle/dv4sandcastle.ts <command> [args...]
 *
 * Commands (mapped from dv work):
 * - list              -> dv work ready (returns selectable candidates)
 * - view <id>         -> dv work show <id>
 * - prompt <id>       -> dv work prompt <id>
 * - claim-task <id>   -> dv work claim <id>
 * - recover-task <id> -> dv work recover <id>
 * - record-task <id>  -> (work record create flow)
 * - close-task <id>   -> (claim release + transition flow)
 * - lock-status       -> dv claim lock-status
 */

import { execFileSync } from "node:child_process";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function runDv(args: string[]): string {
  return execFileSync("node", ["--import", "tsx", "cli/doc-vader.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    fail("Usage: dv4sandcastle <command> [args...]");
  }

  try {
    switch (command) {
      case "list": {
        // Return selectable planning candidates from dv work ready
        const output = runDv(["work", "ready", "--json"]);
        const payload = JSON.parse(output);
        // Extract selectable items in dv4sandcastle format
        console.log(
          JSON.stringify(
            {
              schemaVersion: "dv4sandcastle-list/v1",
              selectable: (payload.candidates || []).map((item: Record<string, unknown>) => ({
                id: String(item.id || "").replace(/^wi-/, ""),
                title: String(item.title || item.id || ""),
                branch: `sandcastle/issue-${String(item.id || "").replace(/^wi-/, "")}`,
                ...(item.priority ? { priority: item.priority } : {}),
              })),
              horizon: (payload.exclusions || []).map((item: Record<string, unknown>) => ({
                id: String(item.id || "").replace(/^wi-/, ""),
                reasonCodes: (item.reasons as Array<{ code: string }> | undefined)?.map(
                  (r) => r.code,
                ) || ["not_ready"],
              })),
            },
            null,
            2,
          ),
        );
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
        const taskId = args[0] ?? fail("Usage: dv4sandcastle claim-task <task-id>");
        process.stdout.write(runDv(["work", "claim", taskId, ...args.slice(1), "--json"]));
        break;
      }

      case "recover-task": {
        const taskId = args[0] ?? fail("Usage: dv4sandcastle recover-task <task-id>");
        process.stdout.write(runDv(["work", "recover", taskId, ...args.slice(1), "--json"]));
        break;
      }

      case "record-task": {
        // Delegate to dv work record with task context
        process.stdout.write(runDv(["work", "record", ...args, "--json"]));
        break;
      }

      case "close-task": {
        // Delegate to claim release with transition behavior
        process.stdout.write(runDv(["claim", "release", ...args, "--json"]));
        break;
      }

      case "lock-status": {
        // Check runtime lock status
        process.stdout.write(runDv(["work", "status", ...args, "--json"]));
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
