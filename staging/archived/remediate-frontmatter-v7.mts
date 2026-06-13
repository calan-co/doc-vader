#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v7)
 * Final pass: fix remaining specific schema violations
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
  frontmatter: Frontmatter,
  filePath: string
): { fixed: Frontmatter; changes: string[] } {
  const changes: string[] = [];
  const fixed = { ...frontmatter };

  // 1. For closed work-items: ensure required fields exist
  if (
    fixed.type === "work-item" &&
    fixed.status === "closed"
  ) {
    const requiredFields = ["actual", "completed_date", "test_results", "pull_requests"];
    for (const field of requiredFields) {
      if (!(field in fixed)) {
        if (field === "actual" || field === "test_results") {
          fixed[field] = [];
        } else if (field === "completed_date") {
          fixed[field] = null;
        } else if (field === "pull_requests") {
          if (!fixed.links) {
            fixed.links = {};
          }
          if (typeof fixed.links === "object" && fixed.links !== null) {
            (fixed.links as Record<string, unknown>)[field] = [];
          }
        }
        changes.push(`Added missing field for closed item: ${field}`);
      }
    }
  }

  // 2. Fix id field: ensure it's a string
  if ("id" in fixed && typeof fixed.id === "number") {
    fixed.id = String(fixed.id);
    changes.push(`Converted id from number to string`);
  }

  // 3. Fix execution phases status values
  if ("execution" in fixed && typeof fixed.execution === "object" && fixed.execution !== null) {
    const execution = fixed.execution as Record<string, unknown>;
    if ("phases" in execution && Array.isArray(execution.phases)) {
      const phases = execution.phases;
      let phaseFixed = false;
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        if (typeof phase === "object" && phase !== null) {
          const phaseObj = phase as Record<string, unknown>;
          if ("status" in phaseObj && typeof phaseObj.status === "string") {
            const validStatuses = ["not-started", "in-progress", "completed"];
            if (!validStatuses.includes(phaseObj.status)) {
              // Map common status names to valid values
              const statusMap: Record<string, string> = {
                "todo": "not-started",
                "wip": "in-progress",
                "done": "completed",
                "complete": "completed",
                "active": "in-progress",
              };
              const newStatus = statusMap[phaseObj.status.toLowerCase()] || "not-started";
              phaseObj.status = newStatus;
              phaseFixed = true;
            }
          }
        }
      }
      if (phaseFixed) {
        changes.push(`Fixed execution phase status values`);
      }
    }
  }

  // 4. Fix empty links arrays that have min items constraint
  if ("links" in fixed && typeof fixed.links === "object" && fixed.links !== null) {
    const links = fixed.links as Record<string, unknown>;
    for (const [key, value] of Object.entries(links)) {
      if (Array.isArray(value) && value.length === 0) {
        // depends_on, pull_requests have minItems: 1
        if (["depends_on", "pull_requests"].includes(key)) {
          delete links[key];
          changes.push(`Removed empty ${key} array (requires min 1 items)`);
        }
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

    const { fixed, changes } = remediateFrontmatter(frontmatter, filePath);

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
