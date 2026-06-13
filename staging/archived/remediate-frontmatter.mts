#!/usr/bin/env node
/**
 * Frontmatter remediation utility
 * Fixes schema compliance violations in documentation and backlog files
 */

import fs from "fs";
import path from "path";
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

// Status mapping for backlog items (common misspellings/old values)
const STATUS_MAPPINGS: Record<string, string> = {
  "completed": "closed",
  "complete": "closed",
  "accepted": "ready",
  "open": "proposed",
  "review": "ready-for-review",
  "inprogress": "in-progress",
  "deprecated": "closed",
};

// Valid status/lifecycle combinations from schema
const LIFECYCLE_STATUS_COMPATIBILITY: Record<string, string[]> = {
  draft: ["proposed", "closed"],
  active: ["ready", "in-progress", "ready-for-review", "closed"],
  evergreen: ["ready", "in-progress", "ready-for-review", "closed"],
  inactive: ["closed"],
};

// Properties that are not allowed in document schema
const DISALLOWED_PROPERTIES = [
  "lastReviewed",
  "createdBy",
  "updated",
  "edited",
];

// Properties to preserve when remediating (these are allowed)
const PRESERVABLE_PROPERTIES = [
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
];

// Properties allowed for work-items only
const WORKITEM_PROPERTIES = [
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
];

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
  rawFrontmatter: string;
} {
  const lines = content.split("\n");
  if (!lines[0]?.startsWith("---")) {
    return { frontmatter: null, body: content, rawFrontmatter: "" };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("---")) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: null, body: content, rawFrontmatter: "" };
  }

  const rawFrontmatter = lines.slice(0, endIndex + 1).join("\n");
  const yamlContent = lines.slice(1, endIndex).join("\n");

  try {
    // Simple YAML parser for basic key-value pairs
    const frontmatter: Frontmatter = {};
    const yamlLines = yamlContent.split("\n");

    for (const line of yamlLines) {
      if (!line.trim() || line.trim().startsWith("#")) continue;

      // Handle simple key: value pairs (not nested objects)
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Try to parse value as JSON, otherwise treat as string
        try {
          frontmatter[key] = JSON.parse(value);
        } catch {
          frontmatter[key] = value.trim();
        }
      }
    }

    const body = lines.slice(endIndex + 1).join("\n");
    return { frontmatter, body, rawFrontmatter };
  } catch {
    return { frontmatter: null, body: content, rawFrontmatter };
  }
}

function serializeFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === "string") {
          lines.push(`  - ${item}`);
        } else {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value, null, 2)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

function remediateFrontmatter(
  frontmatter: Frontmatter
): { fixed: Frontmatter; changes: string[] } {
  const changes: string[] = [];
  const fixed = { ...frontmatter };

  // Determine if this is a document or work-item
  const itemType = fixed.type as string || "document";
  const isWorkItem = itemType === "work-item";

  // 1. Remove disallowed properties
  const allowedProps = new Set([...PRESERVABLE_PROPERTIES]);
  if (isWorkItem) {
    WORKITEM_PROPERTIES.forEach((p) => allowedProps.add(p));
  }

  for (const [key, value] of Object.entries(fixed)) {
    if (!allowedProps.has(key) && !key.startsWith("$")) {
      delete fixed[key];
      changes.push(`Removed disallowed property: ${key}`);
    }
  }

  // 2. Fix status values
  if ("status" in fixed && typeof fixed.status === "string") {
    const oldStatus = fixed.status;
    let newStatus = oldStatus;

    // Check if it needs mapping
    if (oldStatus in STATUS_MAPPINGS) {
      newStatus = STATUS_MAPPINGS[oldStatus];
      changes.push(`Mapped status: ${oldStatus} → ${newStatus}`);
    }

    // Ensure it's in the valid enum
    if (!VALID_STATUSES.includes(newStatus)) {
      // Default to "proposed" for unknown statuses
      newStatus = "proposed";
      changes.push(`Unknown status "${oldStatus}" defaulted to "proposed"`);
    }

    fixed.status = newStatus;
  }

  // 3. Fix lifecycle if needed
  if ("lifecycle" in fixed && typeof fixed.lifecycle === "string") {
    const lifecycle = fixed.lifecycle;
    if (!VALID_LIFECYCLES.includes(lifecycle)) {
      // Default to "active" for most cases
      fixed.lifecycle = "active";
      changes.push(
        `Invalid lifecycle "${lifecycle}" corrected to "active"`
      );
    }
  }

  // 4. Ensure lifecycle/status compatibility
  if ("lifecycle" in fixed && "status" in fixed) {
    const lifecycle = fixed.lifecycle as string;
    const status = fixed.status as string;

    const compatibleStatuses = LIFECYCLE_STATUS_COMPATIBILITY[lifecycle];
    if (compatibleStatuses && !compatibleStatuses.includes(status)) {
      // Use first compatible status
      const newStatus = compatibleStatuses[0];
      fixed.status = newStatus;
      changes.push(
        `Fixed lifecycle/status incompatibility: lifecycle="${lifecycle}" requires status="${newStatus}" (was "${status}")`
      );
    }
  }

  // 4.5. Validate and fix subtype
  if ("subtype" in fixed && typeof fixed.subtype === "string") {
    const subtype = fixed.subtype;
    const validSubtypes = isWorkItem
      ? VALID_WORKITEM_SUBTYPES
      : VALID_DOCUMENT_SUBTYPES;

    if (!validSubtypes.includes(subtype)) {
      const defaultSubtype = isWorkItem ? "task" : "generic";
      fixed.subtype = defaultSubtype;
      changes.push(
        `Invalid subtype "${subtype}" corrected to "${defaultSubtype}"`
      );
    }
  }

  // 5. Ensure required fields exist
  const baseRequiredFields = [
    "id",
    "title",
    "type",
    "subtype",
    "lifecycle",
    "status",
  ];
  const requiredFields = isWorkItem
    ? [...baseRequiredFields, "priority", "estimated"]
    : baseRequiredFields;

  for (const field of requiredFields) {
    if (!(field in fixed)) {
      if (field === "id") {
        fixed.id = isWorkItem
          ? `wi-${Math.floor(Math.random() * 100000)}`
          : `unknown-${Date.now()}`;
        changes.push(`Added missing required field: id=${fixed.id}`);
      } else if (field === "title") {
        fixed.title = "Untitled";
        changes.push(`Added missing required field: title="Untitled"`);
      } else if (field === "type") {
        fixed.type = isWorkItem ? "work-item" : "document";
        changes.push(
          `Added missing required field: type="${fixed.type}"`
        );
      } else if (field === "subtype") {
        fixed.subtype = isWorkItem ? "task" : "generic";
        changes.push(
          `Added missing required field: subtype="${fixed.subtype}"`
        );
      } else if (field === "lifecycle") {
        fixed.lifecycle = "draft";
        changes.push(`Added missing required field: lifecycle="draft"`);
      } else if (field === "status") {
        fixed.status = "proposed";
        changes.push(`Added missing required field: status="proposed"`);
      } else if (field === "priority") {
        fixed.priority = "medium";
        changes.push(`Added missing required field: priority="medium"`);
      } else if (field === "estimated") {
        fixed.estimated = 4;
        changes.push(`Added missing required field: estimated=4`);
      }
    }
  }

  // 6. Fix ID format based on type
  if ("id" in fixed && typeof fixed.id === "string") {
    const id = fixed.id;
    if (isWorkItem) {
      // Work-item IDs must match ^wi-\d+$
      if (!id.match(/^wi-\d+$/)) {
        // Extract numbers or generate new ID
        const numberMatch = id.match(/\d+/);
        const newId = numberMatch
          ? `wi-${numberMatch[0]}`
          : `wi-${Math.floor(Math.random() * 100000)}`;
        fixed.id = newId;
        changes.push(`Fixed work-item ID format: "${id}" → "${newId}"`);
      }
    } else {
      // Document IDs must match ^[a-z]{2,}-\d+$
      if (!id.match(/^[a-z]{2,}-\d+$/)) {
        // Try to sanitize it
        const sanitized = id
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");

        if (!sanitized.match(/^[a-z]{2,}-\d+$/)) {
          // Generate a compliant ID
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

        changes.push(`Fixed document ID format: "${id}" → "${fixed.id}"`);
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

    if (!frontmatter) {
      result.errors.push("No frontmatter found");
      return result;
    }

    const { fixed, changes } = remediateFrontmatter(frontmatter);

    // Only write if there are actual changes
    if (changes.length > 0) {
      const serialized = serializeFrontmatter(fixed);
      const newContent = serialized + "\n" + body;

      fs.writeFileSync(filePath, newContent, "utf-8");
      result.fixed = true;
      result.changes = changes;
    }
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : String(error)
    );
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
  const results: RemediationResult[] = [];

  for (const file of files) {
    const result = processFile(file);
    results.push(result);

    if (result.fixed) {
      fixedCount++;
      console.log(`✓ ${file}`);
      for (const change of result.changes) {
        console.log(`  - ${change}`);
      }
    } else if (result.errors.length > 0) {
      errorCount++;
      console.log(`✗ ${file}`);
      for (const error of result.errors) {
        console.log(`  ERROR: ${error}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Summary:`);
  console.log(`  Fixed: ${fixedCount} files`);
  console.log(`  Errors: ${errorCount} files`);
  console.log(`  Skipped: ${files.length - fixedCount - errorCount} files`);

  // Write detailed report
  const report = {
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    fixed: fixedCount,
    errors: errorCount,
    skipped: files.length - fixedCount - errorCount,
    results: results.filter((r) => r.fixed || r.errors.length > 0),
  };

  fs.writeFileSync(
    "frontmatter-remediation-report.json",
    JSON.stringify(report, null, 2)
  );
  console.log(
    "\nDetailed report written to: frontmatter-remediation-report.json"
  );
}

main().catch(console.error);
