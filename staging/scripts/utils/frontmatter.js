// Utility to validate frontmatter against a JSON schema
const fs = require("fs");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const yaml = require("js-yaml");
const path = require("path");
const { AggregateAjvError } = require("@segment/ajv-human-errors");

/**
 * Extracts frontmatter from a markdown file (YAML or JSON block at top)
 * @param {string} filePath
 * @returns {object|null} Parsed frontmatter or null
 */
function extractFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (match) {
    try {
      return yaml.load(match[1]);
    } catch (e) {
      return null;
    }
  }
  // Try JSON frontmatter (rare)
  const jsonMatch = content.match(/^\{[\s\S]+?\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Validates frontmatter against a JSON schema
 * @param {object} frontmatter
 * @param {string} schemaPath
 * @returns {Array} Array of error messages (empty if valid)
 */
function validateFrontmatter(frontmatter, schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  // Initialize Ajv with verbose mode to enable better error messages
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    verbose: true,
    validateFormats: true,
  });
  addFormats(ajv);

  // Preload all schemas from the repo's schemas directory so $ref can be resolved
  // Supports refs like "./docs.v1.frontmatter.schema.json" or "docs.v1.frontmatter.schema.json"
  try {
    const schemasDir = path.resolve(__dirname, "../../schemas");
    if (fs.existsSync(schemasDir)) {
      for (const fname of fs.readdirSync(schemasDir)) {
        if (!fname.endsWith(".json")) continue;
        const fpath = path.join(schemasDir, fname);
        // Avoid re-reading the same file twice needlessly, but harmless if we do
        try {
          const sObj = JSON.parse(fs.readFileSync(fpath, "utf8"));
          // Register by multiple keys to help Ajv resolve different ref forms
          // 1) by basename (e.g., docs.v1.frontmatter.schema.json)
          ajv.addSchema(sObj, fname);
          // 2) by relative path hint used in refs (e.g., ./docs.v1.frontmatter.schema.json)
          ajv.addSchema(sObj, `./${fname}`);
          // 3) by absolute file path (rarely necessary, but cheap)
          ajv.addSchema(sObj, fpath);
        } catch (e) {
          // Ignore malformed schema files; the compile step will surface errors as needed
        }
      }
    }
  } catch (_) {
    // Ignore preload failures and continue; Ajv will raise a MissingRefError if needed
  }

  const validate = ajv.compile(schema);
  const valid = validate(frontmatter);
  if (valid) return [];

  // Use @segment/ajv-human-errors for better error messages
  try {
    const humanErrors = new AggregateAjvError(validate.errors);
    return humanErrors.message.split("\n").filter((msg) => msg.trim());
  } catch (e) {
    // Fallback to basic error formatting if humanization fails
    return validate.errors.map((e) => `${e.instancePath} ${e.message}`);
  }
}

module.exports = { extractFrontmatter, validateFrontmatter };
