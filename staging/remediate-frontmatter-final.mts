#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v4)
 * Final pass to fix remaining 95 files
 */

import fs from "fs";
import YAML from "js-yaml";
import { globSync } from "glob";

interface Frontmatter {
  [key: string]: unknown;
}

// Properties disallowed for work-items specifically
const DISALLOWED_FOR_WORKITEMS = new Set([
  "title",
  "summary",
  "owner",
  "modified",
  "created",
  "classification",
  "audience",
  "governance",
]);

// Properties disallowed for documents
const DISALLOWED_FOR_DOCUMENTS = new Set([
  "modified",
  "created",
  "lastReviewed",
  "createdBy",
]);

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

  const itemType = (fixed.type as string) || "document";
  const isWorkItem = itemType === "work-item";

  // 1. Remove disallowed properties based on type
  const disallowed = isWorkItem
    ? DISALLOWED_FOR_WORKITEMS
    : DISALLOWED_FOR_DOCUMENTS;

  for (const key of Object.keys(fixed)) {
    if (disallowed.has(key)) {
      delete fixed[key];
      changes.push(`Removed property not allowed for ${itemType}: ${key}`);
    }
  }

  // 2. For work-items: fix links format (array → object)
  if (
    isWorkItem &&
    "links" in fixed &&
    Array.isArray(fixed.links)
  ) {
    const linksArray = fixed.links;
    const linksObj: Record<string, unknown> = {};

    for (const item of linksArray) {
      if (typeof item === "object" && item !== null) {
        const key = Object.keys(item)[0];
        if (key) {
          linksObj[key] = (item as Record<string, unknown>)[key];
        }
      }
    }

    if (Object.keys(linksObj).length > 0) {
      fixed.links = linksObj;
      changes.push(`Converted links from array to object format`);
    } else {
      delete fixed.links;
      changes.push(`Removed empty links array`);
    }
  }

  // 3. For work-items: fix estimated field type (string → number)
  if (isWorkItem && "estimated" in fixed) {
    const value = fixed.estimated;
    if (typeof value === "string") {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        fixed.estimated = numValue;
        changes.push(`Converted estimated from string "${value}" to number`);
      }
    }
  }

  // 4. For work-items with status="closed": ensure status_reason exists
  if (
    isWorkItem &&
    fixed.status === "closed" &&
    !("status_reason" in fixed)
  ) {
    fixed.status_reason = "completed";
    changes.push(`Added status_reason="completed" for closed status`);
  }

  // 5. For work-items: validate status against allowed values for lifecycle
  if (isWorkItem && "status" in fixed && "lifecycle" in fixed) {
    const status = fixed.status as string;
    const lifecycle = fixed.lifecycle as string;

    const validStatuses: Record<string, string[]> = {
      draft: ["proposed", "closed"],
      active: ["proposed", "ready", "in-progress", "ready-for-review", "closed"],
      evergreen: ["proposed", "ready", "in-progress", "ready-for-review", "closed"],
      inactive: ["closed"],
    };

    if (lifecycle in validStatuses) {
      const allowed = validStatuses[lifecycle];
      if (!allowed.includes(status)) {
        const newStatus = allowed[0];
        fixed.status = newStatus;
        changes.push(
          `Fixed status for lifecycle="${lifecycle}": "${status}" → "${newStatus}"`
        );
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

  for (const file of files) {
    const result = processFile(file);
    if (result.fixed) {
      fixedCount++;
      if (result.changes.length > 0) {
        console.log(`✓ ${file}`);
        for (const change of result.changes.slice(0, 2)) {
          console.log(`  - ${change}`);
        }
        if (result.changes.length > 2) {
          console.log(`  ... and ${result.changes.length - 2} more`);
        }
      }
    }
  }

  console.log(`\nFixed ${fixedCount} files`);
}

main().catch(console.error);
