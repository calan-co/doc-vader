import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { withTestStageTiming } from "./helpers/test-stage-timing.js";

const cliPath = path.resolve(__dirname, "../dist/cli/doc-vader.js");
const repoRoot = path.resolve(__dirname, "..");

type Fixture = {
  root: string;
  validDocs: string;
  missingFrontmatterDocs: string;
  emptyTitleDocs: string;
  emptyFileDocs: string;
  missingDocs: string;
};

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "doc-vader-cli-"));
  const docs = (name: string) => path.join(root, name);
  const validDocs = docs("valid-docs");
  const missingFrontmatterDocs = docs("missing-frontmatter");
  const emptyTitleDocs = docs("empty-title");
  const emptyFileDocs = docs("empty-file");

  mkdirSync(validDocs, { recursive: true });
  writeFileSync(
    path.join(validDocs, "valid.md"),
    "---\ntitle: Valid Doc\ntype: document\n---\n# Valid\n",
    "utf8",
  );
  mkdirSync(missingFrontmatterDocs, { recursive: true });
  writeFileSync(
    path.join(missingFrontmatterDocs, "nofrontmatter.md"),
    "# No frontmatter\n",
    "utf8",
  );
  mkdirSync(emptyTitleDocs, { recursive: true });
  writeFileSync(
    path.join(emptyTitleDocs, "edge.md"),
    "---\ntitle: \ntype: document\n---\n# Edge\n",
    "utf8",
  );
  mkdirSync(emptyFileDocs, { recursive: true });
  writeFileSync(path.join(emptyFileDocs, "empty.md"), "", "utf8");

  return {
    root,
    validDocs,
    missingFrontmatterDocs,
    emptyTitleDocs,
    emptyFileDocs,
    missingDocs: docs("missing-docs"),
  };
}

function runCli(args: string[]): string {
  return withTestStageTiming("cli", () => {
    try {
      return execFileSync(process.execPath, [cliPath, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
      });
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        return "stdout" in error && error.stdout
          ? String(error.stdout)
          : String((error as Error).message);
      }
      return String(error);
    }
  });
}

describe("doc-vader built CLI integration", () => {
  let fixture: Fixture;

  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(
        "Built CLI not found. Run `pnpm run build` before integration-cli.memfs.test.ts.",
      );
    }
  });

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    withTestStageTiming("filesystem-cleanup", () =>
      rmSync(fixture.root, { recursive: true, force: true }),
    );
  });

  it("validates a valid markdown file", () => {
    expect(runCli(["frontmatter", "validate", fixture.validDocs])).toMatch(
      /ok:\s*true|warnings:\s*\[\]/i,
    );
  });

  it("fails validation for missing frontmatter", () => {
    expect(
      runCli(["frontmatter", "validate", fixture.missingFrontmatterDocs]),
    ).toMatch(/Missing frontmatter|ok:\s*false|errors:/i);
  });

  it("handles an empty frontmatter title", () => {
    expect(runCli(["frontmatter", "validate", fixture.emptyTitleDocs])).toMatch(
      /ok:\s*true|warnings:|errors:/i,
    );
  });

  it("handles an empty file", () => {
    expect(runCli(["frontmatter", "validate", fixture.emptyFileDocs])).toMatch(
      /Missing frontmatter|ok:\s*false|errors:/i,
    );
  });

  it("errors for a non-existent file", () => {
    expect(runCli(["frontmatter", "validate", fixture.missingDocs])).toMatch(
      /ENOENT|error|invalid/i,
    );
  });
});
