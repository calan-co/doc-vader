import { describe, expect, it } from "vitest";
import {
  evaluateChangesetRequirement,
  formatValidationErrors,
  validateChangesetFile,
} from "../validate-changesets.js";

describe("evaluateChangesetRequirement", () => {
  it("does not require a changeset for CI-exempt documentation and backlog files", () => {
    const result = evaluateChangesetRequirement([
      "docs/how-to/example.md",
      "backlog/123-example.md",
      "README.md",
      ".github/workflows/ci.yml",
      "AGENTS.md",
    ]);

    expect(result.requiresChangeset).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it("requires a changeset for release-relevant files", () => {
    const result = evaluateChangesetRequirement([
      "lib/task/claims.ts",
      "tests/task-command.test.ts",
    ]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.releaseRelevantFiles).toEqual([
      "lib/task/claims.ts",
      "tests/task-command.test.ts",
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it("accepts a release-relevant change when a changeset is present", () => {
    const result = evaluateChangesetRequirement([
      ".changeset/local-check.md",
      "scripts/validate-changesets.ts",
    ]);

    expect(result.requiresChangeset).toBe(true);
    expect(result.changesetFiles).toEqual([".changeset/local-check.md"]);
    expect(result.errors).toEqual([]);
  });
});

describe("validateChangesetFile", () => {
  it("accepts the current package name and release types", () => {
    const result = validateChangesetFile(
      ".changeset/example.md",
      '---\n"@calan-co/doc-vader": patch\n---\n\nFix validation.\n',
      ["@calan-co/doc-vader"],
    );

    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { packageName: "@calan-co/doc-vader", releaseType: "patch" },
    ]);
  });

  it("rejects stale package names", () => {
    const result = validateChangesetFile(
      ".changeset/example.md",
      '---\n"doc-vader": minor\n---\n\nFix validation.\n',
      ["@calan-co/doc-vader"],
    );

    expect(formatValidationErrors([result])).toEqual([
      ".changeset/example.md: unknown package 'doc-vader'; expected one of: @calan-co/doc-vader",
    ]);
  });

  it("rejects empty changeset frontmatter", () => {
    const result = validateChangesetFile(
      ".changeset/example.md",
      "---\n---\n\nMissing release entry.\n",
      ["@calan-co/doc-vader"],
    );

    expect(result.errors).toEqual(["changeset has no package release entries"]);
  });
});
