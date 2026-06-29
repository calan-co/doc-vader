import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORK_COMMAND_ALIASES,
  WORK_COMMAND_INVENTORY,
  iterWorkCommandInventory,
} from "../lib/work/command-inventory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.resolve(repoRoot, "cli/doc-vader.ts");
const helpOutputCache = new Map<string, string>();

function runHelp(commandPath: readonly string[]): string {
  const cacheKey = commandPath.join("\u0000");
  const cached = helpOutputCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const helpOutput = execFileSync(
    "node",
    ["--import", tsxImport, cliPath, ...commandPath, "--help"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
      },
    },
  );
  helpOutputCache.set(cacheKey, helpOutput);
  return helpOutput;
}

function parseImmediateCommandNames(helpOutput: string): string[] {
  const commandsSection = /\nCommands:\n([\s\S]*?)(?:\n\n|$)/u.exec(helpOutput);
  if (!commandsSection) {
    return [];
  }

  return [...commandsSection[1].matchAll(/^ {2}([a-z][a-z-]*)\b/gm)]
    .map((match) => match[1])
    .filter((name) => name !== "help");
}

function normalizeHelpOutput(helpOutput: string): string {
  return helpOutput.replace(/^Usage:.*$/mu, "Usage: <normalized>");
}

describe.sequential("work command inventory parity", () => {
  it("freezes the work command inventory and alias list", () => {
    expect(Object.isFrozen(WORK_COMMAND_ALIASES)).toBe(true);
    expect(Object.isFrozen(WORK_COMMAND_INVENTORY)).toBe(true);
    expect(Object.isFrozen(WORK_COMMAND_INVENTORY[0])).toBe(true);
    expect(Object.isFrozen(WORK_COMMAND_INVENTORY[0]?.children)).toBe(true);
    expect(Object.isFrozen(WORK_COMMAND_INVENTORY[0]?.children[0])).toBe(true);
  });

  it(
    "keeps the immutable inventory aligned with the canonical work tree and alias help",
    { timeout: 90_000 },
    () => {
      const [canonicalAlias, ...compatibilityAliases] = WORK_COMMAND_ALIASES;
      const rootHelp = runHelp([canonicalAlias]);
      expect(parseImmediateCommandNames(rootHelp)).toEqual(
        WORK_COMMAND_INVENTORY.map((entry) => entry.name),
      );
      for (const alias of compatibilityAliases) {
        const aliasHelp = runHelp([alias]);
        expect(normalizeHelpOutput(aliasHelp)).toBe(
          normalizeHelpOutput(rootHelp),
        );
        expect(parseImmediateCommandNames(aliasHelp)).toEqual(
          WORK_COMMAND_INVENTORY.map((entry) => entry.name),
        );
      }

      for (const entry of iterWorkCommandInventory()) {
        const canonicalHelp = runHelp([canonicalAlias, ...entry.path]);
        expect(parseImmediateCommandNames(canonicalHelp)).toEqual(entry.children);

        for (const alias of compatibilityAliases) {
          const aliasHelp = runHelp([alias, ...entry.path]);
          expect(normalizeHelpOutput(aliasHelp)).toBe(
            normalizeHelpOutput(canonicalHelp),
          );
          expect(parseImmediateCommandNames(aliasHelp)).toEqual(entry.children);
        }
      }
    },
  );
});
