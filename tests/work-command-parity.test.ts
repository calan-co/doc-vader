import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WORK_COMMAND_ALIASES,
  WORK_COMMAND_INVENTORY,
  iterWorkCommandInventory,
  type WorkCommandInventoryEntry,
} from "../lib/work/command-inventory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.resolve(repoRoot, "cli/doc-vader.ts");
const commandPathSeparator = "\u0000";
const commandsSectionPattern = /\nCommands:\n([\s\S]*?)(?:\n\n|$)/u;
const immediateCommandPattern = /^ {2}([a-z][a-z-]*)\b/gm;
const rootCommandNames = WORK_COMMAND_INVENTORY.map((entry) => entry.name);
const helpOutputCache = new Map<string, string>();

function runHelp(commandPath: readonly string[]): string {
  const cacheKey = commandPath.join(commandPathSeparator);
  const cached = helpOutputCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const helpOutput = execFileSync(
    process.execPath,
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
  const commandsSection = commandsSectionPattern.exec(helpOutput);
  if (!commandsSection) {
    return [];
  }

  return [...commandsSection[1].matchAll(immediateCommandPattern)]
    .map((match) => match[1])
    .filter((name) => name !== "help");
}

function normalizeHelpOutput(helpOutput: string): string {
  return helpOutput.replace(/^Usage:.*$/mu, "Usage: <normalized>");
}

function expectFrozenInventory(
  entries: readonly WorkCommandInventoryEntry[],
): void {
  expect(Object.isFrozen(entries)).toBe(true);
  for (const entry of entries) {
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.children)).toBe(true);
    expectFrozenInventory(entry.children);
  }
}

function expectHelpSnapshot(
  commandPath: readonly string[],
  expectedCommandNames: readonly string[],
): string {
  const helpOutput = runHelp(commandPath);
  expect(parseImmediateCommandNames(helpOutput)).toEqual(expectedCommandNames);
  return normalizeHelpOutput(helpOutput);
}

describe.sequential("work command inventory parity", () => {
  it("freezes the work command inventory and alias list", () => {
    expect(Object.isFrozen(WORK_COMMAND_ALIASES)).toBe(true);
    expectFrozenInventory(WORK_COMMAND_INVENTORY);
  });

  it(
    "keeps the immutable inventory aligned with the canonical work tree and alias help",
    { timeout: 90_000 },
    () => {
      const [canonicalAlias, ...compatibilityAliases] = WORK_COMMAND_ALIASES;
      const rootHelp = expectHelpSnapshot([canonicalAlias], rootCommandNames);
      for (const alias of compatibilityAliases) {
        expect(expectHelpSnapshot([alias], rootCommandNames)).toBe(rootHelp);
      }

      for (const entry of iterWorkCommandInventory()) {
        const canonicalHelp = expectHelpSnapshot(
          [canonicalAlias, ...entry.path],
          entry.children,
        );

        for (const alias of compatibilityAliases) {
          expect(expectHelpSnapshot([alias, ...entry.path], entry.children)).toBe(
            canonicalHelp,
          );
        }
      }
    },
  );
});
