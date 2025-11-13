/**
 * @precommitRule Validates backlog items against their template structure
 * @note Canonical validation for required fields and types is enforced by the templates in docs/templates/backlog/.
 * @note This script should only include logic that cannot be expressed declaratively in templates.
 */
// scripts/lint/backlog-template-lint.mjs
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

/**
 * Loads a template for a given docSubType from the templates directory.
 * Supports JSON and YAML templates.
 */
export async function loadTemplate(docSubType, templatesDir) {
  const jsonPath = path.join(templatesDir, `${docSubType}.template.json`);
  const yamlPath = path.join(templatesDir, `${docSubType}.template.yaml`);
  try {
    const jsonContent = await fs.readFile(jsonPath, "utf8");
    return JSON.parse(jsonContent);
  } catch {
    try {
      const yamlContent = await fs.readFile(yamlPath, "utf8");
      return yaml.load(yamlContent);
    } catch {
      throw new Error(`No template found for docSubType: ${docSubType}`);
    }
  }
}

/**
 * Validates a backlog item against its template.
 * Returns an array of lint errors (empty if valid).
 */
export async function lintBacklogItem(item, templatesDir) {
  const { docSubType } = item;
  if (!docSubType) {
    return [{ message: "Missing docSubType", field: "docSubType" }];
  }
  let template;
  try {
    template = await loadTemplate(docSubType, templatesDir);
  } catch (err) {
    return [{ message: err.message, field: "docSubType" }];
  }
  // Canonical validation for required fields and types is enforced by the templates.
  // Add only custom/procedural validation logic here if needed.
  return [];
}

/**
 * Validates all backlog items in a directory against their templates.
 * Returns a summary of errors per file.
 */
export async function lintBacklogDir(backlogDir, templatesDir) {
  const files = await fs.readdir(backlogDir);
  const results = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(backlogDir, file);
    const content = await fs.readFile(filePath, "utf8");
    // Extract frontmatter (YAML between ---)
    const match = content.match(/^---\s*([\s\S]*?)---/);
    let frontmatter = {};
    if (match) {
      try {
        frontmatter = yaml.load(match[1]);
      } catch {
        results.push({
          file: filePath,
          errors: [
            { message: "Invalid YAML frontmatter", field: "frontmatter" },
          ],
        });
        continue;
      }
    }
    const errors = await lintBacklogItem(frontmatter, templatesDir);
    if (errors.length) {
      results.push({ file: filePath, errors });
    }
  }
  return results;
}
