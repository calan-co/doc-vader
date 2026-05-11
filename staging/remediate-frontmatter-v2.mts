#!/usr/bin/env node
/**
 * Frontmatter remediation utility (v2)
 * Fixes schema compliance violations using proper YAML parsing
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

// Status mapping for backlog items
const STATUS_MAPPINGS: Record<string, string> = {
  "completed": "closed",
  "complete": "closed",
  "accepted": "ready",
  "open": "proposed",
  "review": "ready-for-review",
  "inprogress": "in-progress",
  "deprecated": "closed",
};

// Valid status/lifecycle combinations
const LIFECYCLE_STATUS_COMPATIBILITY: Record<string, string[]> = {
  draft: ["proposed", "closed"],
  active: ["ready", "in-progress", "ready-for-review", "closed"],
  evergreen: ["ready", "in-progress", "ready-for-review", "closed"],
  inactive: ["closed"],
};

// Properties allowed for all items
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

// Properties allowed for work-items only
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

function parseYAMLFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
} {
  const lines = content.split("\n");
  if (!lines[0]?.startsWith("---")) {
    return { frontmatter: null, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("---")) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");

  try {
    const frontmatter: Frontmatter = {};
    const yamlLines = yamlContent.split("\n");
    let currentKey: string | null = null;
    let currentValue: string[] = [];
    let inArray = false;
    let inQuotedString = false;

    for (const line of yamlLines) {
      if (!line.trim() || line.trim().startsWith("#")) {
        continue;
      }

      // Check if this is a new key-value pair
      if (!line.startsWith(" ") && line.includes(":")) {
        // Save previous key if exists
        if (currentKey) {
          const valueStr = currentValue.join("\n").trim();
          if (inArray) {
            frontmatter[currentKey] = valueStr
              .split("\n")
              .map((v) => v.replace(/^\s*-\s*/, "").trim())
              .filter((v) => v);
          } else {
            frontmatter[currentKey] = valueStr;
          }
        }

        // Parse new key
        const colonIndex = line.indexOf(":");
        currentKey = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        currentValue = [];
        inArray = value.startsWith("[") || false;

        if (value) {
          currentValue.push(value);
        }
      } else if (line.startsWith("  -") && currentKey) {
        // Array item
        inArray = true;
        const item = line.replace(/^\s*-\s*/, "").trim();
        currentValue.push(item);
      } else if (line.startsWith(" ") && currentKey) {
        // Continuation of value
        currentValue.push(line);
      }
    }

    // Save last key
    if (currentKey) {
      const valueStr = currentValue.join("\n").trim();
      if (inArray) {
        frontmatter[currentKey] = valueStr
          .split("\n")
          .map((v) => v.replace(/^\s*-\s*/, "").trim())
          .filter((v) => v);
      } else {
        frontmatter[currentKey] = valueStr;
      }
    }

    return { frontmatter, body };
  } catch {
    return { frontmatter: null, body: content };
  }
}

function serializeYAMLFrontmatter(frontmatter: Frontmatter): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === null || value === undefined) {
      continue;
    } else if (typeof value === "string") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === "string") {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof value === "object") {
      // For complex objects, output as JSON embedded in YAML
      lines.push(`${key}:`);
      const jsonStr = JSON.stringify(value, null, 2);
      for (const jsonLine of jsonStr.split("\n")) {
        lines.push(`  ${jsonLine}`);
      }
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

  // Determine if this is a work-item or document
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

  // 2. Fix status values
  if ("status" in fixed && typeof fixed.status === "string") {
    let newStatus = fixed.status;

    if (newStatus in STATUS_MAPPINGS) {
      newStatus = STATUS_MAPPINGS[newStatus];
      changes.push(`Mapped status: ${fixed.status} → ${newStatus}`);
    }

    if (!VALID_STATUSES.includes(newStatus)) {
      const oldStatus = newStatus;
      newStatus = "proposed";
      changes.push(`Unknown status "${oldStatus}" defaulted to "proposed"`);
    }

    fixed.status = newStatus;
  }

  // 3. Fix lifecycle
  if ("lifecycle" in fixed && typeof fixed.lifecycle === "string") {
    if (!VALID_LIFECYCLES.includes(fixed.lifecycle)) {
      const oldLifecycle = fixed.lifecycle;
      fixed.lifecycle = "active";
      changes.push(`Invalid lifecycle "${oldLifecycle}" corrected to "active"`);
    }
  }

  // 4. Ensure lifecycle/status compatibility
  if ("lifecycle" in fixed && "status" in fixed) {
    const lifecycle = fixed.lifecycle as string;
    const status = fixed.status as string;
    const compatibleStatuses = LIFECYCLE_STATUS_COMPATIBILITY[lifecycle];

    if (
      compatibleStatuses &&
      !compatibleStatuses.includes(status)
    ) {
      const newStatus = compatibleStatuses[0];
      fixed.status = newStatus;
      changes.push(
        `Fixed lifecycle/status incompatibility: lifecycle="${lifecycle}" requires status="${newStatus}" (was "${status}")`
      );
    }
  }

  // 5. Validate and fix subtype
  if ("subtype" in fixed && typeof fixed.subtype === "string") {
    const validSubtypes = isWorkItem
      ? VALID_WORKITEM_SUBTYPES
      : VALID_DOCUMENT_SUBTYPES;

    if (!validSubtypes.includes(fixed.subtype)) {
      const oldSubtype = fixed.subtype;
      fixed.subtype = isWorkItem ? "task" : "generic";
      changes.push(
        `Invalid subtype "${oldSubtype}" corrected to "${fixed.subtype}"`
      );
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
      // Work-item: wi-\d+
      if (!id.match(/^wi-\d+$/)) {
        const numberMatch = id.match(/\d+/);
        fixed.id = numberMatch
          ? `wi-${numberMatch[0]}`
          : `wi-${Math.floor(Math.random() * 100000)}`;
        changes.push(`Fixed work-item ID: "${id}" → "${fixed.id}"`);
      }
    } else {
      // Document: [a-z]{2,}-\d+
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
    const { frontmatter, body } = parseYAMLFrontmatter(content);

    if (!frontmatter) {
      result.errors.push("No frontmatter found");
      return result;
    }

    const { fixed, changes } = remediateFrontmatter(frontmatter);

    if (changes.length > 0) {
      const serialized = serializeYAMLFrontmatter(fixed);
      const newContent = serialized + "\n" + body;
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
}

main().catch(console.error);
