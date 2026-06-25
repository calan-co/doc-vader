#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BACKLOG_DIR = "backlog";

const clean = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");

const splitFrontmatter = (content, file) => {
  if (!content.startsWith("---\n")) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }

  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${file}: unterminated YAML frontmatter`);
  }

  return {
    frontmatter: content.slice(4, end),
    body: content.slice(end + "\n---".length).trim(),
  };
};

const parseFrontmatter = (text) => {
  const data = {};
  let currentMap = null;
  let currentArrayKey = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    const topLevel = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (topLevel) {
      const [, key, value = ""] = topLevel;
      currentMap = null;
      currentArrayKey = null;
      if (value.trim() === "") {
        data[key] = {};
        currentMap = data[key];
      } else {
        data[key] = clean(value);
      }
      continue;
    }

    const nestedKey = /^  ([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (nestedKey && currentMap) {
      const [, key, value = ""] = nestedKey;
      if (value.trim() === "") {
        currentMap[key] = [];
        currentArrayKey = key;
      } else {
        currentMap[key] = clean(value);
        currentArrayKey = null;
      }
      continue;
    }

    const nestedArray = /^    -\s+(.+)$/.exec(line);
    if (nestedArray && currentMap && currentArrayKey) {
      currentMap[currentArrayKey].push(clean(nestedArray[1]));
      continue;
    }

    const topLevelArray = /^  -\s+(.+)$/.exec(line);
    if (topLevelArray) {
      const key = Object.keys(data).at(-1);
      if (!Array.isArray(data[key])) {
        data[key] = [];
      }
      data[key].push(clean(topLevelArray[1]));
    }
  }

  return data;
};

const normalizeId = (value) => {
  const basename = path.basename(clean(value), ".md").replace(/^wi-/, "");
  const match = /^(\d+(?:\.\d+)*)/.exec(basename);
  return match ? match[1] : basename;
};

const sections = (body) => {
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)];
  return headings.map((match, index) => {
    const next = headings[index + 1];
    return {
      heading: match[1].trim(),
      content: body.slice(match.index + match[0].length, next?.index).trim(),
    };
  });
};

const readIssue = (needle) => {
  const normalizedNeedle = normalizeId(needle);
  for (const file of fs.readdirSync(BACKLOG_DIR).sort()) {
    if (!file.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(BACKLOG_DIR, file);
    const content = fs.readFileSync(filePath, "utf8");
    const { frontmatter, body } = splitFrontmatter(content, filePath);
    const data = parseFrontmatter(frontmatter);
    const id = normalizeId(data.id ?? file);

    if (id !== normalizedNeedle && !file.startsWith(`${normalizedNeedle}-`)) {
      continue;
    }

    return {
      id,
      number: id,
      title: clean(data.title ?? id),
      status: clean(data.status ?? ""),
      state: ["completed", "aborted", "closed"].includes(clean(data.status))
        ? "closed"
        : "open",
      priority: clean(data.priority ?? ""),
      tags: Array.isArray(data.tags) ? data.tags : [],
      dependencies: Array.isArray(data.links?.depends_on)
        ? data.links.depends_on
        : [],
      references: Array.isArray(data.links?.reference)
        ? data.links.reference
        : [],
      file: filePath,
      frontmatter: data,
      body,
      bodySections: sections(body),
    };
  }

  throw new Error(`No backlog issue found for ${needle}.`);
};

const taskId = process.argv[2];
if (!taskId) {
  console.error("Usage: node .sandcastle/view-issue.mjs <task-id>");
  process.exit(2);
}

try {
  console.log(JSON.stringify(readIssue(taskId), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
