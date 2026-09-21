import { Command } from "commander";
import type { Readable, Writable } from "node:stream";
import { runInit } from "./index.js";
import { createTerminalInitPrompt } from "./prompt.js";

interface InitCommandStdio {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
  error: Writable;
}

const collectOption = (value: string, previous: string[] = []) => [...previous, value];

export function registerInitCommand(
  surface: Command,
  stdio: InitCommandStdio = {
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
  },
): void {
  surface
    .command("init")
    .description("Initialize selected bundled or installed document packs")
    .option("--dir <path>", "Target directory; defaults to the Git root or current directory")
    .option("--pack <id>", "Document pack to initialize (repeatable)", collectOption, [])
    .option("--yes", "Apply without a confirmation prompt")
    .option("--dry-run", "Show the selected packs without writing files")
    .option("--json", "Print the result as JSON")
    .action(async (opts: { dir?: string; pack: string[]; yes?: boolean; dryRun?: boolean; json?: boolean }) => {
      const prompt = createTerminalInitPrompt(
        stdio.input,
        opts.json ? stdio.error : stdio.output,
        Boolean(stdio.input.isTTY && stdio.output.isTTY),
      );
      try {
        const result = await runInit({ ...opts, packIds: opts.pack, prompt });
        stdio.output.write(`${opts.json ? JSON.stringify(result, null, 2) : result.dryRun ? `Would initialize: ${result.planned.join(", ")}` : `Initialized: ${result.applied.join(", ")}`}\n`);
        if (result.failed.length) process.exitCode = 1;
      } catch (error) {
        stdio.error.write(`${opts.json ? JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) : error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
