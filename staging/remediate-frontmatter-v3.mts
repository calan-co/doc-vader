#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v3)
 * Fixes schema compliance violations using js-yaml for proper YAML handling
 */

import fs from "fs";
import YAML from "js-yaml";
import { globSync } from "glob";

interface Frontmatter {
  [key: string]: unknown;
}

interface RemediationResult {
  file: string;
  fixed: boolean;
  changes: string[];
  errors: string[];
}

// Valid enums from the schema
const VALID_STATUSES = [
  "proposed",
  "ready",
  "in-progress",
  "ready-for-review",
  "closed",
];
const VALID_LIFECYCLES = ["draft", "active", "evergreen", "inactive"];
const VALID_DOCUMENT_SUBTYPES = ["brief", "guide", "reference", "explanation", "generic", "template"];
const VALID_WORKITEM_SUBTYPES = ["story", "task", "bug", "epic", "spike"];

// Status mapping
const STATUS_MAPPINGS: Record<string, string> = {
  "completed": "closed",
  "complete": "closed",
  "accepted": "ready",
  "open": "proposed",
  "review": "ready-for-review",
  "inprogress": "in-progress",
  "deprecated": "closed",
};

// Lifecycle/status compatibility
const LIFECYCLE_STATUS_COMPATIBILITY: Record<string, string[]> = {
  draft: ["proposed", "closed"],
  active: ["ready", "in-progress", "ready-for-review", "closed"],
  evergreen: ["ready", "in-progress", "ready-for-review", "closed"],
  inactive: ["closed"],
};

// Allowed properties
const COMMON_PROPERTIES = new Set([
  "id",
  "title",
  "type",
  "subtype",
  "lifecycle",
  "status",
  "status_reason",
  "tags",
  "links",
  "summary",
  "owner",
  "classification",
  "audience",
  "governance",
]);

const WORKITEM_PROPERTIES = new Set([
  "priority",
  "estimated",
  "actual",
  "assignee",
  "commits",
  "completed_date",
  "complexity",
  "execution",
  "linked_pull_requests",
  "notes",
  "blocked_by",
  "depends_on",
  "modified",
  "created",
  "ordinal",
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

  // 1. Remove disallowed properties
  const allowedProps = new Set([...COMMON_PROPERTIES]);
  if (isWorkItem) {
    for (const prop of WORKITEM_PROPERTIES) {
      allowedProps.add(prop);
    }
  }

  for (const key of Object.keys(fixed)) {
    if (!allowedProps.has(key) && !key.startsWith("$")) {
      delete fixed[key];
      changes.push(`Removed disallowed property: ${key}`);
    }
  }

  // 2. Fix status
  if ("status" in fixed && typeof fixed.status === "string") {
    let newStatus = fixed.status;
    if (newStatus in STATUS_MAPPINGS) {
      newStatus = STATUS_MAPPINGS[newStatus];
      changes.push(`Mapped status: ${fixed.status} → ${newStatus}`);
    }
    if (!VALID_STATUSES.includes(newStatus)) {
      const old = newStatus;
      newStatus = "proposed";
      changes.push(`Unknown status "${old}" defaulted to "proposed"`);
    }
    fixed.status = newStatus;
  }

  // 3. Fix lifecycle
  if ("lifecycle" in fixed && typeof fixed.lifecycle === "string") {
    if (!VALID_LIFECYCLES.includes(fixed.lifecycle)) {
      const old = fixed.lifecycle;
      fixed.lifecycle = "active";
      changes.push(`Invalid lifecycle "${old}" corrected to "active"`);
    }
  }

  // 4. Fix lifecycle/status compatibility
  if ("lifecycle" in fixed && "status" in fixed) {
    const lifecycle = fixed.lifecycle as string;
    const status = fixed.status as string;
    const compatibleStatuses = LIFECYCLE_STATUS_COMPATIBILITY[lifecycle];
    if (compatibleStatuses && !compatibleStatuses.includes(status)) {
      const newStatus = compatibleStatuses[0];
      fixed.status = newStatus;
      changes.push(
        `Fixed lifecycle/status incompatibility: lifecycle="${lifecycle}" requires status="${newStatus}" (was "${status}")`
      );
    }
  }

  // 5. Fix subtype
  if ("subtype" in fixed && typeof fixed.subtype === "string") {
    const validSubtypes = isWorkItem
      ? VALID_WORKITEM_SUBTYPES
      : VALID_DOCUMENT_SUBTYPES;
    if (!validSubtypes.includes(fixed.subtype)) {
      const old = fixed.subtype;
      fixed.subtype = isWorkItem ? "task" : "generic";
      changes.push(`Invalid subtype "${old}" corrected to "${fixed.subtype}"`);
    }
  }

  // 6. Ensure required fields
  const requiredFields = [
    "id",
    "title",
    "type",
    "subtype",
    "lifecycle",
    "status",
  ];
  if (isWorkItem) {
    requiredFields.push("priority", "estimated");
  }

  for (const field of requiredFields) {
    if (!(field in fixed)) {
      if (field === "id") {
        fixed.id = isWorkItem
          ? `wi-${Math.floor(Math.random() * 100000)}`
          : `unknown-${Date.now()}`;
      } else if (field === "title") {
        fixed.title = "Untitled";
      } else if (field === "type") {
        fixed.type = isWorkItem ? "work-item" : "document";
      } else if (field === "subtype") {
        fixed.subtype = isWorkItem ? "task" : "generic";
      } else if (field === "lifecycle") {
        fixed.lifecycle = "draft";
      } else if (field === "status") {
        fixed.status = "proposed";
      } else if (field === "priority") {
        fixed.priority = "medium";
      } else if (field === "estimated") {
        fixed.estimated = 4;
      }
      changes.push(`Added missing required field: ${field}=${fixed[field]}`);
    }
  }

  // 7. Fix ID format
  if ("id" in fixed && typeof fixed.id === "string") {
    const id = fixed.id;
    if (isWorkItem) {
      if (!id.match(/^wi-\d+$/)) {
        const numberMatch = id.match(/\d+/);
        fixed.id = numberMatch
          ? `wi-${numberMatch[0]}`
          : `wi-${Math.floor(Math.random() * 100000)}`;
        changes.push(`Fixed work-item ID: "${id}" → "${fixed.id}"`);
      }
    } else {
      if (!id.match(/^[a-z]{2,}-\d+$/)) {
        const sanitized = id
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");

        if (!sanitized.match(/^[a-z]{2,}-\d+$/)) {
          const baseId = id
            .toLowerCase()
            .replace(/[^a-z]/g, "")
            .slice(0, 8);
          fixed.id =
            baseId.length >= 2
              ? `${baseId}-${Math.floor(Math.random() * 10000)}`
              : `doc-${Math.floor(Math.random() * 100000)}`;
        } else {
          fixed.id = sanitized;
        }
        changes.push(`Fixed document ID: "${id}" → "${fixed.id}"`);
      }
    }
  }

  return { fixed, changes };
}

function processFile(filePath: string): RemediationResult {
  const result: RemediationResult = {
    file: filePath,
    fixed: false,
    changes: [],
    errors: [],
  };

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter || typeof frontmatter !== "object") {
      result.errors.push("No valid frontmatter found");
      return result;
    }

    const { fixed, changes } = remediateFrontmatter(frontmatter);

    if (changes.length > 0) {
      const serialized = YAML.dump(fixed, {
        lineWidth: -1,
        indent: 2,
        quotingType: "'",
      });
      const newContent = `---\n${serialized}---\n${body}`;
      fs.writeFileSync(filePath, newContent, "utf-8");
      result.fixed = true;
      result.changes = changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

async function main() {
  const patterns = ["docs/**/*.md", "backlog/**/*.md", "*.md"];
  const files = globSync(patterns, {
    ignore: ["node_modules/**", "dist/**", ".git/**"],
  });

  console.log(`Found ${files.length} markdown files to process`);

  let fixedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const result = processFile(file);

    if (result.fixed) {
      fixedCount++;
      console.log(`✓ ${file}`);
      for (const change of result.changes.slice(0, 3)) {
        console.log(`  - ${change}`);
      }
      if (result.changes.length > 3) {
        console.log(`  ... and ${result.changes.length - 3} more`);
      }
    } else if (result.errors.length > 0) {
      errorCount++;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Summary:`);
  console.log(`  Fixed: ${fixedCount} files`);
  console.log(`  Errors: ${errorCount} files`);
  console.log(`  Skipped: ${files.length - fixedCount - errorCount} files`);
}

main().catch(console.error);
