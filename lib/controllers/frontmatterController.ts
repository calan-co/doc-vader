// Controller for frontmatter utilities
import { Ajv } from "ajv";
import { validateFrontmatter } from "../frontmatter/index.js";
import path from "node:path";

export async function lint(options: {
  docsDir: string;
  schemaDir?: string;
  strict?: boolean;
}) {
  const { docsDir, schemaDir, strict: strictMissing } = options;
  const ajv = new Ajv({ allErrors: true });
  const schemaDirectory = schemaDir || path.join(docsDir, "schemas");
  // Example: validate all markdown files in docsDir
  // You may want to use readMarkdownFiles from utils for batch validation
  // Here, just return a single result for demonstration
  return validateFrontmatter({
    filePath: docsDir,
    strictMissing,
    schemaDir: schemaDirectory,
    ajv,
  });
}

export { parseFrontmatter as parse } from "../frontmatter/index.js";
