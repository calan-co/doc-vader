#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v6)
 * Remove disallowed properties and fix audience field
 */

import fs from "fs";
import YAML from "js-yaml";
import { globSync } from "glob";

interface Frontmatter {
  [key: string]: unknown;
}

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  try {
    const frontmatter = YAML.load(match[1]) as Frontmatter;
    const body = content.substring(match[0].length);
    return { frontmatter, body };
  } catch {
    return { frontmatter: null, body: content };
  }
}

function remediateFrontmatter(
  frontmatter: Frontmatter
): { fixed: Frontmatter; changes: string[] } {
  const changes: string[] = [];
  const fixed = { ...frontmatter };

  // 1. Remove disallowed properties that appear in error messages
  const disallowedProps = [
    "modified",
    "created",
    "createdBy",
    "lastReviewed",
    "classification",
    "workItemType",
    "name",
    "annotations",
    "relations",
  ];

  for (const prop of disallowedProps) {
    if (prop in fixed) {
      delete fixed[prop];
      changes.push(`Removed disallowed property: ${prop}`);
    }
  }

  // 2. Fix audience field - should be array of valid enum values
  if ("audience" in fixed) {
    const validValues = [
      "integrators",
      "contributors",
      "operators",
      "endUsers",
      "administrators",
      "executives",
    ];

    let audienceValue = fixed.audience;

    // If it's a string, convert to array
    if (typeof audienceValue === "string") {
      audienceValue = [audienceValue];
    }

    // If it's an array, validate and filter values
    if (Array.isArray(audienceValue)) {
      const filtered = audienceValue
        .map((v) => String(v).toLowerCase())
        .filter((v) => {
          // Try to match to valid values (case-insensitive)
          for (const valid of validValues) {
            if (v === valid.toLowerCase()) {
              return true;
            }
          }
          return false;
        })
        .map((v) => {
          // Map back to correct case
          for (const valid of validValues) {
            if (v === valid.toLowerCase()) {
              return valid;
            }
          }
          return v;
        });

      if (filtered.length === 0) {
        delete fixed.audience;
        changes.push(`Removed audience field with invalid values`);
      } else if (
        filtered.length !== audienceValue.length ||
        !filtered.every((v, i) => v === audienceValue[i])
      ) {
        fixed.audience = filtered;
        changes.push(`Fixed audience field values to: ${filtered.join(", ")}`);
      }
    }
  }

  return { fixed, changes };
}

function processFile(filePath: string): { fixed: boolean; changes: string[] } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter || typeof frontmatter !== "object") {
      return { fixed: false, changes: [] };
    }

    const { fixed, changes } = remediateFrontmatter(frontmatter);

    if (changes.length > 0) {
      const serialized = YAML.dump(fixed, {
        lineWidth: -1,
        indent: 2,
      });
      const newContent = `---\n${serialized}---\n${body}`;
      fs.writeFileSync(filePath, newContent, "utf-8");
      return { fixed: true, changes };
    }
  } catch (error) {
    // Silent fail for files we can't process
  }

  return { fixed: false, changes: [] };
}

async function main() {
  const patterns = ["docs/**/*.md", "backlog/**/*.md", "*.md"];
  const files = globSync(patterns, {
    ignore: ["node_modules/**", "dist/**", ".git/**"],
  });

  let fixedCount = 0;
  let totalChanges = 0;

  for (const file of files) {
    const result = processFile(file);
    if (result.fixed) {
      fixedCount++;
      totalChanges += result.changes.length;
      console.log(`✓ ${file}`);
      for (const change of result.changes) {
        console.log(`  - ${change}`);
      }
    }
  }

  console.log(`\nFixed ${fixedCount} files with ${totalChanges} total changes`);
}

main().catch(console.error);
