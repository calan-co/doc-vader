import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

const archivedFiles = [
  ["staging/scripts/lint.js", "staging/archived/scripts/lint.js"],
  [
    "staging/scripts/generate-templates-from-schema.js",
    "staging/archived/scripts/generate-templates-from-schema.js",
  ],
  [
    "staging/scripts/generate-validation-workflow-doc.js",
    "staging/archived/scripts/generate-validation-workflow-doc.js",
  ],
  ["staging/remediate-frontmatter.mts", "staging/archived/remediate-frontmatter.mts"],
  [
    "staging/remediate-frontmatter-v2.mts",
    "staging/archived/remediate-frontmatter-v2.mts",
  ],
  [
    "staging/remediate-frontmatter-v3.mts",
    "staging/archived/remediate-frontmatter-v3.mts",
  ],
  [
    "staging/remediate-frontmatter-v5.mts",
    "staging/archived/remediate-frontmatter-v5.mts",
  ],
  [
    "staging/remediate-frontmatter-v6.mts",
    "staging/archived/remediate-frontmatter-v6.mts",
  ],
  [
    "staging/remediate-frontmatter-v7.mts",
    "staging/archived/remediate-frontmatter-v7.mts",
  ],
  [
    "staging/remediate-frontmatter-final.mts",
    "staging/archived/remediate-frontmatter-final.mts",
  ],
  [
    "staging/scripts/lint/crossref-fix.cjs",
    "staging/archived/scripts/lint/crossref-fix.cjs",
  ],
  [
    "staging/scripts/lint/frontmatter-fix.cjs",
    "staging/archived/scripts/lint/frontmatter-fix.cjs",
  ],
  [
    "staging/scripts/lint/naming-conventions-fix.cjs",
    "staging/archived/scripts/lint/naming-conventions-fix.cjs",
  ],
  [
    "staging/scripts/lint/ascii-to-mermaid-fix.cjs",
    "staging/archived/scripts/lint/ascii-to-mermaid-fix.cjs",
  ],
  [
    "staging/scripts/lint/convert-ascii-to-mermaid.cjs",
    "staging/archived/scripts/lint/convert-ascii-to-mermaid.cjs",
  ],
  [
    "staging/scripts/lint/heading-style-fix.cjs",
    "staging/archived/scripts/lint/heading-style-fix.cjs",
  ],
  [
    "staging/scripts/lint/fix-all-errors.cjs",
    "staging/archived/scripts/lint/fix-all-errors.cjs",
  ],
  [
    "staging/scripts/lint/fix-all-errors-prioritized.cjs",
    "staging/archived/scripts/lint/fix-all-errors-prioritized.cjs",
  ],
  [
    "staging/scripts/lint/chatmode-lint.cjs",
    "staging/archived/scripts/lint/chatmode-lint.cjs",
  ],
  [
    "staging/scripts/lint/folder-structure-lint.cjs",
    "staging/archived/scripts/lint/folder-structure-lint.cjs",
  ],
  [
    "staging/scripts/lint/story-structure-lint.mjs",
    "staging/archived/scripts/lint/story-structure-lint.mjs",
  ],
  [
    "staging/scripts/lint/doc-status-transition-lint.cjs",
    "staging/archived/scripts/lint/doc-status-transition-lint.cjs",
  ],
  [
    "staging/scripts/lint/readme-structure-lint.cjs",
    "staging/archived/scripts/lint/readme-structure-lint.cjs",
  ],
  [
    "staging/scripts/lint/lint-util.cjs",
    "staging/archived/scripts/lint/lint-util.cjs",
  ],
] as const;

describe("staging archive", () => {
  it("moves deprecated staging scripts into staging/archived", () => {
    for (const [oldPath, newPath] of archivedFiles) {
      expect(existsSync(path.join(repoRoot, oldPath))).toBe(false);
      expect(existsSync(path.join(repoRoot, newPath))).toBe(true);
    }

    const readme = readFileSync(path.join(repoRoot, "staging/archived/README.md"), "utf8");
    expect(readme).toMatch(/deprecated staging scripts/i);
    expect(readme).toMatch(/wi-192/i);
  });
});
