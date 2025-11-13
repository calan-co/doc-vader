// Utility to select the correct frontmatter schema for a given file
const path = require("path");

/**
 * Returns the absolute path to the schema for a given markdown file.
 * @param {string} filePath - Absolute path to the markdown file
 * @param {object} frontmatter - Parsed frontmatter object
 * @returns {string|null} Absolute path to schema file, or null if not found
 */
function selectSchema(filePath, frontmatter) {
  const relPath = path.relative(process.cwd(), filePath);
  if (relPath.startsWith("docs/")) {
    return path.resolve(
      process.cwd(),
      "schemas/docs.latest.frontmatter.schema.json"
    );
  }
  if (relPath.startsWith("backlog/")) {
    // If backlog schema exists, use it
    const backlogSchema = path.resolve(
      process.cwd(),
      "schemas/work-item.latest.frontmatter.schema.json"
    );
    try {
      require("fs").accessSync(backlogSchema);
      return backlogSchema;
    } catch {
      return null;
    }
  }
  // Add more rules here if needed, e.g. based on frontmatter.docType
  return null;
}

module.exports = selectSchema;
