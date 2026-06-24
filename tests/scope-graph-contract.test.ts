import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function expectContentToContainAll(
  content: string,
  fragments: readonly string[],
): void {
  for (const fragment of fragments) {
    expect(content).toContain(fragment);
  }
}

const contractChecks = [
  {
    description: "records the stable hash, reservation, lookup, and derivation contract",
    path: "backlog/records/record-20260623-60342-scope-graph-contract.md",
    fragments: [
      "Identical canonical payloads must produce the same `scope_hash`",
      "`reserve` stores or recovers a scope graph",
      "returns a hash without creating an execution claim",
      "`--dry-run` reports the would-be hash and validation result without",
      "Scope lookup must fail closed for unclaimable work",
      "Scope derivation must produce a new graph hash",
      "Lookup by task ID and by `scope_hash`",
      "Nested artifact and section-level claim behavior remains deferred",
    ] as const,
  },
  {
    description: "keeps the work item linked to the deferred scope graph record",
    path: "backlog/60342-task-scope-reservation-and-lookup.md",
    fragments: [
      "[[record-20260623-60342-scope-graph-contract]]",
      "- [x] Cover stable hash, duplicate payload, malformed payload, unclaimable task, dry-run, and lookup behavior in tests.",
      "- [x] Tests for deterministic storage, lookup, and fail-closed reservation.",
    ] as const,
  },
] as const;

describe("wi-60342 deferred scope graph contract", () => {
  for (const { description, path: filePath, fragments } of contractChecks) {
    it(description, async () => {
      const content = await readRepoFile(filePath);

      expectContentToContainAll(content, fragments);
    });
  }
});
