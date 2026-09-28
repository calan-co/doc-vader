import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

describe("MVP scope", () => {
  it("excludes the retired Sandcastle adapter surface", () => {
    for (const relativePath of [
      ".sandcastle",
      "lib/sandcastle",
      "scripts/sandcastle",
      "docs/how-to/sandcastle-dogfood-task-flow.md",
    ]) {
      expect(existsSync(path.join(repoRoot, relativePath))).toBe(false);
    }

    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    );
    expect(packageJson.devDependencies?.["@ai-hero/sandcastle"]).toBeUndefined();
    expect(readFileSync(path.join(repoRoot, "docs/project-brief.md"), "utf8")).not.toContain(
      "dv4sandcastle",
    );
  });
});
