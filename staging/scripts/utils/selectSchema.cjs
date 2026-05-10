// Utility to select the correct frontmatter schema for a given file
const path = require("path");

/**
 * Returns the absolute path to the schema for a given markdown file.
 * @param {string} filePath - Absolute path to the markdown file
 * @param {object} frontmatter - Parsed frontmatter object
 * @returns {string|null} Absolute path to schema file, or null if not found
 */
function selectSchema(filePath, frontmatter) {
  const fs = require("fs");
  
  // 1. Use the type field from frontmatter if it exists
  if (frontmatter && typeof frontmatter === "object" && frontmatter.type) {
    const typeValue = String(frontmatter.type).toLowerCase();
    
    if (typeValue === "work-item") {
      return path.resolve(
        process.cwd(),
        "schemas/frontmatter/by-type/work-item/latest.json",
      );
    }
    
    if (typeValue === "document") {
      return path.resolve(
        process.cwd(),
        "schemas/frontmatter/by-type/document/latest.json",
      );
    }

    // Non-canonical types are intentionally out of scope for the current
    // work-item/document validation gate.
    return null;
  }
  
  // 2. Fallback to directory-based selection if type is not specified
  const relPath = path.relative(process.cwd(), filePath);
  if (relPath.startsWith("docs/")) {
    return path.resolve(
      process.cwd(),
      "schemas/frontmatter/by-type/document/latest.json",
    );
  }
  if (relPath.startsWith("backlog/")) {
    // If backlog schema exists, use it
    const backlogSchema = path.resolve(
      process.cwd(),
      "schemas/frontmatter/by-type/work-item/latest.json",
    );
    try {
      fs.accessSync(backlogSchema);
      return backlogSchema;
    } catch {
      return null;
    }
  }
  // Add more rules here if needed, e.g. based on frontmatter.docType
  return null;
}

module.exports = selectSchema;
