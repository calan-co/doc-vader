// Utility to validate frontmatter against a JSON schema
const fs = require("fs");
const addFormats = require("ajv-formats");
const yaml = require("js-yaml");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
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
async function validateFrontmatter(frontmatter, schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  // Initialize Ajv with verbose mode and async schema loading
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    verbose: true,
    validateFormats: true,
    // Use draft-2020-12 for schema validation
    // defaultMeta: "https://json-schema.org/draft/2020-12/schema",
    loadSchema: async (uri) => {
      // Dynamically resolve schema file path from $id or relative ref
      let p;
      if (uri.startsWith("/")) {
        // Absolute $id, treat as relative to schemas root
        p = path.resolve(__dirname, "../../../schemas" + uri + ".json");
      } else if (uri.startsWith(".")) {
        // Relative ref, treat as relative to main schema
        p = path.resolve(path.dirname(schemaPath), uri);
      } else {
        // Fallback: try as filename in schemas root
        p = path.resolve(__dirname, "../../../schemas", uri);
      }
      if (!fs.existsSync(p)) {
        throw new Error(`Schema not found: ${p}`);
      }
      return JSON.parse(fs.readFileSync(p, "utf8"));
    },
  });
  addFormats(ajv);

  try {
    const validate = await ajv.compileAsync(schema);
    const valid = validate(frontmatter);
    if (valid) return [];
    try {
      // Preprocess unevaluatedProperties errors as Ajv does not handle them yet
      validate.errors
        .filter((e) => e.keyword === "unevaluatedProperties")
        .forEach(
          (e) =>
            (e.message = ` has an unexpected property, ${
              e.params.unevaluatedProperty
            }, which is not in the list of allowed properties (${Object.keys(
              e.parentSchema?.properties ?? {}
            ).join(", ")})`)
        );
      const humanErrors = new AggregateAjvError(validate.errors);
      return humanErrors.errors
        .flatMap((e) => e.message.split("\n"))
        .filter((msg) => msg.trim());
    } catch (e) {
      return validate.errors.map(
        (e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`
      );
    }
  } catch (err) {
    // Ajv schema loading or compilation error
    return [err.message || String(err)];
  }
}

module.exports = { extractFrontmatter, validateFrontmatter };
