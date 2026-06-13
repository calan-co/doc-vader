#!/usr/bin/env node
/**
 * Auto-generate documentation and work-item templates, linter configs, and validation logic from the JSON schema in /schemas.
 *
 * - Source of truth: schemas/frontmatter/document/latest.json, schemas/frontmatter/work-item/latest.json
 * - All templates reference the schema via a comment or metadata.
 * - All field rules, enums, and descriptions are embedded from the schema.
 * - Usage: npm run docs:generate-templates
 */

const fs = require("fs");
const path = require("path");

const DOC_SCHEMA_PATH = path.join(
  __dirname,
  "../schemas/frontmatter/document/latest.json"
);
const WORK_ITEM_SCHEMA_PATH = path.join(
  __dirname,
  "../schemas/frontmatter/work-item/latest.json"
);
const TEMPLATE_DIR = path.join(__dirname, "../docs/templates/backlog/");
const EXAMPLES_DIR = path.join(__dirname, "../docs/examples/");

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

function fieldLine(field, schema, required) {
  let desc = schema.description ? `# ${schema.description}` : "";
  let enumVals = schema.enum ? `# Allowed: ${schema.enum.join(", ")}` : "";
  let req = required ? "" : " # optional";
  return `${field}: <${field}> ${req} ${desc} ${enumVals}`.trim();
}

function buildFrontmatterFromData(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach((v) => lines.push(`  - ${JSON.stringify(v)}`));
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

function buildFrontmatter(schema, requiredFields, data) {
  if (data) return buildFrontmatterFromData(data);
  const lines = ["---", `# See: ${schema.$id || schema["$schema"] || ""}`];
  for (const field of Object.keys(schema.properties)) {
    const prop = schema.properties[field];
    const required = requiredFields.includes(field);
    lines.push(fieldLine(field, prop, required));
  }
  lines.push("---\n");
  return lines.join("\n");
}

function generateTemplate(schemaPath, templatePath, outPath, data) {
  const schema = loadSchema(schemaPath);
  const requiredFields = schema.required || [];
  const frontmatter = buildFrontmatter(
    schema,
    requiredFields,
    data && data.frontmatter
  );
  let body = "";
  if (data && data.markdown) {
    // If markdown is a string, use as-is; if object, join sections
    if (typeof data.markdown === "string") {
      body = data.markdown;
    } else if (typeof data.markdown === "object") {
      body = Object.entries(data.markdown)
        .map(([section, content]) => {
          if (Array.isArray(content)) {
            return `## ${section}\n\n${content
              .map((i) => (typeof i === "string" ? "- " + i : ""))
              .join("\n")}`;
          } else if (typeof content === "object") {
            // Nested object (e.g., Actors)
            return (
              `## ${section}\n\n` +
              Object.entries(content)
                .map(([k, v]) => `- **${k}:** ${v}`)
                .join("\n")
            );
          } else {
            return `## ${section}\n\n${content}`;
          }
        })
        .join("\n\n");
    }
  } else {
    // Read template markdown body (after frontmatter directive)
    const tpl = fs.readFileSync(templatePath, "utf8");
    // Remove any frontmatter or directive lines
    body = tpl
      .replace(/^<!--.*?-->\s*/s, "")
      .replace(/^---[\s\S]*?---\s*/s, "");
  }
  const output = `${frontmatter}\n${body.trim()}\n`;
  fs.writeFileSync(outPath, output, "utf8");
  console.log(`Generated: ${outPath}`);
}

function main() {
  // Generate templates (frontmatter only, no prepopulated data)
  generateTemplate(
    DOC_SCHEMA_PATH,
    path.join(TEMPLATE_DIR, "document.tpl.md"),
    path.join(TEMPLATE_DIR, "document.tpl.md")
  );
  generateTemplate(
    WORK_ITEM_SCHEMA_PATH,
    path.join(TEMPLATE_DIR, "work-item.tpl.md"),
    path.join(TEMPLATE_DIR, "work-item.tpl.md")
  );

  // Optionally, generate example files if data is provided (pseudo-code, replace with real data)
  // const epicExample = require('./epic.example.json');
  // generateExample('epic', WORK_ITEM_SCHEMA_PATH, path.join(TEMPLATE_DIR, 'epic.tpl.md'), path.join(EXAMPLES_DIR, 'epic.example.md'), epicExample);
}

if (require.main === module) main();
