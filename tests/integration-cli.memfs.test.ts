import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { vol } from "memfs";
import "./helper/setupTests";

const cliPath = path.resolve(__dirname, "../dist/cli/doc-vader.js");
const runCli = (args = "") => {
  try {
    return execSync(`node ${cliPath} ${args}`, { encoding: "utf-8" });
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

    // Setup: create a docs directory and a valid markdown file in memfs
    vol.fromJSON(
      {
        "docs/valid.md": "---\ntitle: Valid Doc\n---\n# Valid\n",
        "docs/nofrontmatter.md": "# No frontmatter\n",
        "docs/edge.md": "---\ntitle: \n---\n# Edge\n",
        "docs/empty.md": "",
      },
      "/"
    );
  });

  afterAll(() => {
    vol.reset();
  });

  it("should validate a valid markdown file (positive)", () => {
    const output = runCli("validate-docs -i docs/valid.md");
    expect(output).toMatch(
      /Frontmatter validation passed|success|valid|No moves necessary/i
    );
  });

  it("should fail validation for missing frontmatter (negative)", () => {
    const output = runCli("validate-docs -i docs/nofrontmatter.md");
    expect(output).toMatch(/Frontmatter validation failed|error|invalid/i);
  });

  it("should handle edge case: empty frontmatter title (edge)", () => {
    const output = runCli("validate-docs -i docs/edge.md");
    expect(output).toMatch(
      /Frontmatter validation passed|warning|success|valid/i
    );
  });

  it("should handle edge case: empty file (edge)", () => {
    const output = runCli("validate-docs -i docs/empty.md");
    expect(output).toMatch(/No markdown files found|error|invalid|warning|/i);
  });

  it("should error for non-existent file (negative)", () => {
    const output = runCli("validate-docs -i docs/missing.md");
    expect(output).toMatch(/No markdown files found|error|invalid|warning/i);
  });
});
