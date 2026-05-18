import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  reconcile,
  detect,
} from "../lib/controllers/governanceController.js";

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("governanceController.reconcile", () => {
  it("produces deterministic priority-order reconciliation and trace output", async () => {
    const tmp = await mkTmpDir("doc-vader-governance-");
    cleanupDirs.push(tmp);

    const file = path.join(tmp, "example.md");
    await writeFile(
      file,
      `---
title: Example
id: doc-001
type: document
subtype: concept
lifecycle: active
status: ready
governance:
  profiles:
    diataxis:
      mode: strict
    tgdp:
      mode: advisory
    sdlc:
      mode: strict
    priorityOrder:
      - tgdp
      - diataxis
---
\n# Example\n`,
    );

    const result = await reconcile(file, { strategy: "priority-order", dryRun: true });

    expect(result.appliedStrategy).toBe("priority-order");
    expect(result.conflicts).toEqual([
      { category: "documentation", candidates: ["diataxis", "tgdp"] },
    ]);
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "documentation",
          winner: "tgdp",
          reason: "priorityOrder",
        }),
      ]),
    );
    expect(Array.isArray(result.trace)).toBe(true);
    expect(result.trace.join("\n")).toContain("winner=tgdp");
  });

  it("rejects unsupported non-deterministic strategy values", async () => {
    const tmp = await mkTmpDir("doc-vader-governance-strategy-");
    cleanupDirs.push(tmp);

    const file = path.join(tmp, "example.md");
    await writeFile(
      file,
      `---
title: Example
id: doc-002
type: document
subtype: concept
lifecycle: active
status: ready
governance:
  profiles:
    - diataxis
---
\n# Example\n`,
    );

    await expect(reconcile(file, { strategy: "prompt" })).rejects.toThrow(
      /Unsupported reconciliation strategy/,
    );
  });

  it("detect reads nested governance profiles from frontmatter", async () => {
    const tmp = await mkTmpDir("doc-vader-governance-detect-");
    cleanupDirs.push(tmp);

    const file = path.join(tmp, "example.md");
    await writeFile(
      file,
      `---
title: Example
id: doc-003
type: document
subtype: concept
lifecycle: active
status: ready
governance:
  profiles:
    - diataxis
    - sdlc
---
\n# Example\n`,
    );

    const result = await detect(file);
    expect(result).toHaveLength(1);
    expect(result[0].profiles.map((p) => p.name)).toEqual(["diataxis", "sdlc"]);
  });
});
