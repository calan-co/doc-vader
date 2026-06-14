#!/usr/bin/env node

/**
 * @precommitRule Validates work item hierarchy and decomposition
 * @precommitRule Epic → Feature → Story → Task hierarchy must be followed
 * @precommitRule Stories must use "As a...I want...so that" format
 * @precommitRule Tasks should be atomic (<5 major steps)
 * @precommitRule All work items must link to their parent (except epics)
 * @precommitRule Work item subtypes must match template intent
 * @note Canonical validation for required fields, types, and enums is enforced by the schema and templates.
 * @note This script only enforces hierarchy, parent/child, atomicity, and cross-file rules.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const BACKLOG_DIR = path.join(__dirname, "../../backlog");

const VALID_HIERARCHY = {
  epic: {
    canContain: ["feature"],
    mustHaveParent: false,
  },
  feature: {
    canContain: ["story"],
    mustBeChildOf: ["epic"],
    mustHaveParent: true,
  },
  story: {
    canContain: ["task"],
    mustBeChildOf: ["feature"],
    mustHaveParent: true,
  },
  task: {
    canContain: [],
    mustBeChildOf: ["story"],
    mustHaveParent: true,
  },
};

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  try {
    return yaml.load(match[1]);
  } catch (err) {
    console.warn(`Warning: Could not parse frontmatter: ${err.message}`);
    return null;
  }
}

function normalizeLinkEntries(links) {
  if (!links) return [];

  if (Array.isArray(links)) {
    return links.flatMap((link) => {
      if (typeof link === "string") {
        return [{ target: link }];
      }
      if (link && typeof link === "object") {
        return [link];
      }
      return [];
    });
  }

  if (typeof links === "object") {
    return Object.entries(links).flatMap(([type, targets]) => {
      const values = Array.isArray(targets) ? targets : [targets];
      return values.flatMap((target) => {
        if (typeof target === "string") {
          return [{ type, target }];
        }
        if (target && typeof target === "object") {
          return [{ type, ...target }];
        }
        return [];
      });
    });
  }

  return [];
}

function validateWorkItem(filePath, filename) {
  const content = fs.readFileSync(filePath, "utf8");
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter || frontmatter.type !== "work-item") {
    return [];
  }

  const errors = [];
  const subtype = frontmatter.subtype;

  const rules = VALID_HIERARCHY[subtype];
  if (!rules) {
    // Should hit this if VALID_HIERARCHY does not align with schemas/work-item.latest.frontmatter.schema.json
    errors.push(`Unknown subtype '${subtype}'`);
    return errors;
  }

  // Validate story format
  if (subtype === "story") {
    const hasProperFormat =
      content.includes("As a ") &&
      content.includes("I want") &&
      content.includes("so that");

    if (!hasProperFormat) {
      errors.push(
        `Story missing proper user story format "As a...I want...so that"`
      );
    }

    if (normalizeLinkEntries(frontmatter.links).length === 0) {
      errors.push(
        `Story has no links to parent feature (stories must implement a feature)`
      );
    }
  }

  // Validate task atomicity
  if (subtype === "task") {
    // Check for multi-stage tasks that should be broken down
    const stepMatches = content.match(/^#+\s+Step\s+\d+:/gm);
    if (stepMatches && stepMatches.length > 5) {
      errors.push(
        `Task may be too complex (${stepMatches.length} steps), consider breaking into multiple tasks (<5 steps recommended)`
      );
    }
  }

  // Validate parent links
  if (rules.mustHaveParent) {
    const links = normalizeLinkEntries(frontmatter.links);
    if (links.length === 0) {
      errors.push(
        `${subtype} must link to parent ${rules.mustBeChildOf.join(" or ")}`
      );
    } else {
      let hasValidParent = false;

      for (const link of links) {
        if (!link.target) continue;

        // Extract work item number from wikilink
        const targetMatch = link.target.match(/\[\[(\d+)\./);
        if (!targetMatch) continue;

        const targetNumber = targetMatch[1];
        const linkedFiles = fs
          .readdirSync(BACKLOG_DIR)
          .filter((f) => f.startsWith(`${targetNumber}.`));

        if (linkedFiles.length > 0) {
          const linkedPath = path.join(BACKLOG_DIR, linkedFiles[0]);
          const linkedContent = fs.readFileSync(linkedPath, "utf8");
          const linkedFrontmatter = extractFrontmatter(linkedContent);

          if (
            linkedFrontmatter &&
            rules.mustBeChildOf.includes(linkedFrontmatter.subtype)
          ) {
            hasValidParent = true;
            break;
          }
        }
      }

      if (!hasValidParent) {
        errors.push(
          `${subtype} must link to parent ${rules.mustBeChildOf.join(
            " or "
          )} (check links.type and target)`
        );
      }
    }
  }

  return errors;
}

// Main execution
function main() {
  console.log("🏗️  Validating work item hierarchy...\n");

  if (!fs.existsSync(BACKLOG_DIR)) {
    console.error(`❌ Backlog directory not found: ${BACKLOG_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(BACKLOG_DIR).filter((f) => f.endsWith(".md"));
  let totalErrors = 0;
  let filesChecked = 0;

  for (const file of files) {
    const errors = validateWorkItem(path.join(BACKLOG_DIR, file), file);
    filesChecked++;

    if (errors.length > 0) {
      console.error(`\n❌ ${file}:`);
      errors.forEach((err) => console.error(`   • ${err}`));
      totalErrors += errors.length;
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`Files checked: ${filesChecked}`);
  console.log(`Total errors: ${totalErrors}`);

  if (totalErrors > 0) {
    console.error(`\n❌ ${totalErrors} hierarchy validation errors found`);
    console.error("   Fix errors and run again\n");
    process.exit(1);
  } else {
    console.log("\n✅ All work items follow proper hierarchy\n");
  }
}

main();
