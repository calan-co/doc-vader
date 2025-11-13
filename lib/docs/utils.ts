import { promises as fs } from "node:fs";
import path from "node:path";
import check from "./check.js";
import Ajv from "ajv";
import { validateFrontmatter } from "../frontmatter/utils.js";
import DocsChecker from "./check.js";
export { lintDocs, formatAjvErrors } from "./lint.js";
export { check };
// Utility: Validate Diataxis for a file

async function validateDiataxis(
  filePath: string
): Promise<{ file: string; error?: string }> {
  const checker = new DocsChecker();
  const content = await fs.readFile(filePath, "utf8");
  const result = await checker.check({ filePath, content });
  return { file: filePath, error: result.valid ? undefined : result.error };
}
// Aggregator: Validate all docs
export async function validateDocsWorkflow(options: {
  docsDir: string;
  schemaDir: string;
  strict: boolean;
  ajv: InstanceType<typeof Ajv>;
}) {
  const mdFiles = await readMarkdownFiles(options.docsDir);
  if (mdFiles.length === 0) {
    return {
      results: [],
      diataxisErrors: [],
      failures: [],
      warnings: [],
      missingWarnings: [],
      mdFiles,
    };
  }
  const results = await Promise.all(
    mdFiles.map((f) =>
      validateFrontmatter({
        filePath: f,
        strictMissing: options.strict,
        schemaDir: options.schemaDir,
        ajv: options.ajv,
      })
    )
  );
  const diataxisResults = await Promise.all(
    mdFiles.map((f) => validateDiataxis(f))
  );
  const diataxisErrors = diataxisResults.filter((r) => r.error);
  const failures = results.filter((r) => !r.ok && r.errors.length);
  const warnings = results.flatMap((r) => r.warnings || []);
  const missingWarnings = results.filter((r) => (r.warnings || []).length);
  return {
    results,
    diataxisErrors,
    failures,
    warnings,
    missingWarnings,
    mdFiles,
  };
}

export { classifyDocs } from "./classify.js";

export async function readMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

export async function list(dir: string): Promise<string[]> {
  // Recursively list markdown files, skipping dotfiles and schemas
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip dotfiles
    if (entry.name === "schemas") continue; // skip schemas directory
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await list(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}
