#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v5)
 * Focus on real structural schema issues, not unevaluatedProperties validation bugs
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

function fixLinks(links: unknown): Record<string, unknown> {
  // Links should be { depends_on: [...], pull_requests: [...], implements: [...], implementedBy: [...], parent: [...] }
  // But some files have links as array of objects like [{ implements: [...] }, { pull_request: '...' }]
  // Convert to proper object format
  
  if (!Array.isArray(links)) {
    // Already an object, but might need structure fixes
    if (typeof links === "object" && links !== null) {
      const obj = links as Record<string, unknown>;
      const fixed: Record<string, unknown> = {};
      
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
          fixed[key] = value;
        } else if (typeof value === "string") {
          // Single value, should be array
          fixed[key] = [value];
        } else {
          fixed[key] = value;
        }
      }
      return fixed;
    }
    return {};
  }
  
  // Convert array format to object format
  const result: Record<string, unknown> = {};
  for (const item of links) {
    if (typeof item === "object" && item !== null) {
      for (const [key, value] of Object.entries(item)) {
        if (!result[key]) {
          result[key] = [];
        }
        if (Array.isArray(result[key])) {
          if (Array.isArray(value)) {
            (result[key] as unknown[]).push(...value);
          } else {
            (result[key] as unknown[]).push(value);
          }
        }
      }
    }
  }
  return result;
}

function remediateFrontmatter(
  frontmatter: Frontmatter
): { fixed: Frontmatter; changes: string[] } {
  const changes: string[] = [];
  const fixed = { ...frontmatter };

  const itemType = (fixed.type as string) || "document";

  // 1. Fix links structure if it's an array
  if ("links" in fixed && Array.isArray(fixed.links)) {
    const fixedLinks = fixLinks(fixed.links);
    if (Object.keys(fixedLinks).length > 0) {
      fixed.links = fixedLinks;
      changes.push(`Converted links from array to object format`);
    } else {
      delete fixed.links;
      changes.push(`Removed empty links`);
    }
  }

  // 2. For work-items: fix estimated field type (string → number)
  if (itemType === "work-item" && "estimated" in fixed) {
    const value = fixed.estimated;
    if (typeof value === "string") {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        fixed.estimated = numValue;
        changes.push(`Converted estimated from string "${value}" to number`);
      }
    }
  }

  // 3. For work-items with status="closed": ensure status_reason exists
  if (
    itemType === "work-item" &&
    fixed.status === "closed" &&
    !("status_reason" in fixed)
  ) {
    fixed.status_reason = "completed";
    changes.push(`Added status_reason="completed" for closed status`);
  }

  // 4. For items: ensure status and lifecycle are compatible
  if ("status" in fixed && "lifecycle" in fixed) {
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
        // Try to find a valid status
        let newStatus = allowed[0];
        if (status === "in-review") {
          newStatus = "ready-for-review";
        } else if (status === "wip") {
          newStatus = "in-progress";
        }
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
  let totalChanges = 0;

  for (const file of files) {
    const result = processFile(file);
    if (result.fixed) {
      fixedCount++;
      totalChanges += result.changes.length;
      console.log(`✓ ${file}`);
      for (const change of result.changes.slice(0, 2)) {
        console.log(`  - ${change}`);
      }
      if (result.changes.length > 2) {
        console.log(`  ... and ${result.changes.length - 2} more`);
      }
    }
  }

  console.log(`\nFixed ${fixedCount} files with ${totalChanges} total changes`);
}

main().catch(console.error);
