#!/usr/bin/env node
/**
 * @precommitRule Enforces allowed documentation status values and valid state transitions for markdown files with YAML frontmatter.
 * @note Canonical allowed status values and lifecycle/status transitions are now enforced by JSON schema (see schemas/docs.latest.frontmatter.schema.json).
 * @note This script only enforces procedural/cross-file logic (e.g., git-based transition checks) that cannot be expressed in schema.
 * @note All required status value validation is now in schema. This script only checks for valid transitions using git history.
 */
/**
 * doc-status-transition-lint.js
 *
 * Enforces allowed documentation status values and valid state transitions for markdown files with YAML frontmatter.
 *
 * - Checks that only allowed status values are used
 * - If a file's status is changed, ensures the transition is valid (using git history)
 * - Intended for use by pre-commit hooks
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { execSync } = require("child_process");

// Load allowed statuses and transitions from schema
const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../schemas/docs.latest.frontmatter.schema.json"
);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

// Allowed statuses (from status property enum)
const ALLOWED_STATUSES =
  schema.properties && schema.properties.status && schema.properties.status.enum
    ? schema.properties.status.enum
    : [];

// Allowed transitions (from statusTransitions property)
const ALLOWED_TRANSITIONS =
  schema.statusTransitions && schema.statusTransitions.properties
    ? Object.fromEntries(
        Object.entries(schema.statusTransitions.properties).map(([k, v]) => [
          k,
          v.items && v.items.enum ? v.items.enum : [],
        ])
      )
    : {};

function getStagedMarkdownFiles() {
  const output = execSync(
    "git diff --cached --name-only --diff-filter=ACM"
  ).toString();
  return output.split("\n").filter((f) => f.endsWith(".md"));
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]);
  } catch (e) {
    return null;
  }
}

function getPreviousStatus(filepath) {
  try {
    const prev = execSync(`git show :0:${filepath}`).toString();
    const fm = extractFrontmatter(prev);
    return fm && fm.status ? fm.status : null;
  } catch {
    return null; // New file or not tracked
  }
}

function main() {
  let hasError = false;
  const files = getStagedMarkdownFiles();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    const fm = extractFrontmatter(content);
    if (!fm || !fm.status) continue; // No frontmatter or no status
    // Status value validation is now handled by schema. Only check transitions here.
    const prevStatus = getPreviousStatus(file);
    if (prevStatus && fm.status !== prevStatus) {
      const allowed = ALLOWED_TRANSITIONS[prevStatus] || [];
      if (!allowed.includes(fm.status)) {
        console.error(
          `\x1b[31m✗ ${file}: Invalid status transition: ${prevStatus} → ${
            fm.status
          }. Allowed: ${allowed.join(", ") || "(none)"}\x1b[0m`
        );
        hasError = true;
      }
    }
  }
  if (hasError) process.exit(1);
}

main();
