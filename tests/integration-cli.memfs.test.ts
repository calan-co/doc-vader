import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const cliPath = path.resolve(__dirname, "../dist/cli/doc-vader.js");
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "doc-vader-cli-"));

const runCli = (args = "") => {
  try {
    return execSync(`node ${cliPath} ${args}`, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
  } catch (err) {
    if (typeof err === "object" && err !== null) {
      // @ts-ignore
      return err.stdout ? String(err.stdout) : String((err as Error).message);
    }
    return String(err);
  }
};

describe("doc-vader CLI integration with memfs", () => {
  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(
        "Built CLI not found. Run `pnpm run build` before integration-cli.memfs.test.ts.",
      );
    }
  });

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("should validate a valid markdown file (positive)", () => {
    const docsDir = path.join(tempRoot, "valid-docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      path.join(docsDir, "valid.md"),
      "---\ntitle: Valid Doc\ntype: document\n---\n# Valid\n",
      "utf8",
    );
    const output = runCli(`frontmatter validate ${docsDir}`);
    expect(output).toMatch(/ok:\s*true|warnings:\s*\[\]/i);
  });

  it("should fail validation for missing frontmatter (negative)", () => {
    const docsDir = path.join(tempRoot, "missing-frontmatter");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(path.join(docsDir, "nofrontmatter.md"), "# No frontmatter\n", "utf8");
    const output = runCli(`frontmatter validate ${docsDir}`);
    expect(output).toMatch(/Missing frontmatter|ok:\s*false|errors:/i);
  });

  it("should handle edge case: empty frontmatter title (edge)", () => {
    const docsDir = path.join(tempRoot, "empty-title");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      path.join(docsDir, "edge.md"),
      "---\ntitle: \ntype: document\n---\n# Edge\n",
      "utf8",
    );
    const output = runCli(`frontmatter validate ${docsDir}`);
    expect(output).toMatch(/ok:\s*true|warnings:|errors:/i);
  });

  it("should handle edge case: empty file (edge)", () => {
    const docsDir = path.join(tempRoot, "empty-file");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(path.join(docsDir, "empty.md"), "", "utf8");
    const output = runCli(`frontmatter validate ${docsDir}`);
    expect(output).toMatch(/Missing frontmatter|ok:\s*false|errors:/i);
  });

  it("should error for non-existent file (negative)", () => {
    const output = runCli(`frontmatter validate ${path.join(tempRoot, "missing-docs")}`);
    expect(output).toMatch(/ENOENT|error|invalid/i);
  });
});
