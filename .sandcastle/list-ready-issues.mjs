#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const BACKLOG_DIR = "backlog";
const ARCHIVE_DIR = path.join(BACKLOG_DIR, "archive");
const READY_STATUSES = new Set(["ready"]);
const SATISFIED_STATUSES = new Set(["completed", "closed"]);
const CLOSED_LIFECYCLES = new Set(["archived", "closed"]);

const readMarkdownFiles = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort();

const readDependencyMarkdownFiles = () => [
  ...readMarkdownFiles(BACKLOG_DIR),
  ...(fs.existsSync(ARCHIVE_DIR) ? readMarkdownFiles(ARCHIVE_DIR) : []),
];

const parseScalar = (value) => value.replace(/^['"]|['"]$/g, "").trim();

const parseFrontmatter = (content, file) => {
  if (!content.startsWith("---\n")) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }

  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${file}: unterminated YAML frontmatter`);
  }

  const frontmatter = {};
  const lines = content.slice(4, end).split("\n");
  let currentMap = null;
  let currentArrayKey = null;

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }

    const topLevelMatch = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (topLevelMatch) {
      const [, key, value = ""] = topLevelMatch;
      currentMap = null;
      currentArrayKey = null;

      if (value.trim() === "") {
        frontmatter[key] = {};
        currentMap = frontmatter[key];
      } else {
        frontmatter[key] = parseScalar(value);
      }
      continue;
    }

    const nestedKeyMatch = /^  ([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (nestedKeyMatch && currentMap) {
      const [, key, value = ""] = nestedKeyMatch;
      if (value.trim() === "") {
        currentMap[key] = [];
        currentArrayKey = key;
      } else {
        currentMap[key] = parseScalar(value);
        currentArrayKey = null;
      }
      continue;
    }

    const nestedArrayMatch = /^    -\s+(.+)$/.exec(line);
    if (nestedArrayMatch && currentMap && currentArrayKey) {
      currentMap[currentArrayKey].push(parseScalar(nestedArrayMatch[1]));
      continue;
    }

    const topLevelArrayMatch = /^  -\s+(.+)$/.exec(line);
    if (topLevelArrayMatch) {
      const keys = Object.keys(frontmatter);
      const key = keys.at(-1);
      if (!Array.isArray(frontmatter[key])) {
        frontmatter[key] = [];
      }
      frontmatter[key].push(parseScalar(topLevelArrayMatch[1]));
    }
  }

  return {
    frontmatter,
    body: content.slice(end + "\n---".length),
  };
};

const normalizeRef = (value) => {
  const withoutWiki = value.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const withoutAlias = withoutWiki.split("|")[0];
  const basename = path.basename(withoutAlias, ".md");
  const withoutPrefix = basename.replace(/^wi-/, "");
  const idMatch = /^(\d+(?:\.\d+)*)/.exec(withoutPrefix);
  return idMatch ? idMatch[1] : withoutPrefix;
};

const extractSection = (body, heading) => {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const match = pattern.exec(body);
  if (!match) {
    return "";
  }

  const rest = body.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
};

const extractWikiLinks = (text) =>
  [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]);

const collectDependencyRefs = ({ frontmatter, body }) => {
  const dependencyRefs = new Set();
  const dependsOn = frontmatter.links?.depends_on;

  if (Array.isArray(dependsOn)) {
    for (const ref of dependsOn) {
      dependencyRefs.add(ref);
    }
  } else if (typeof dependsOn === "string") {
    dependencyRefs.add(dependsOn);
  }

  for (const section of ["Dependencies", "Blocked by"]) {
    for (const ref of extractWikiLinks(extractSection(body, section))) {
      dependencyRefs.add(ref);
    }
  }

  return [...dependencyRefs].map(normalizeRef);
};

const loadItems = () => {
  const items = [];

  for (const file of readDependencyMarkdownFiles()) {
    const content = fs.readFileSync(file, "utf8");
    const parsed = parseFrontmatter(content, file);
    const id = normalizeRef(parsed.frontmatter.id ?? path.basename(file));
    const filenameId = normalizeRef(path.basename(file, ".md"));
    const tags = Array.isArray(parsed.frontmatter.tags)
      ? parsed.frontmatter.tags
      : [];

    items.push({
      id,
      filenameId,
      title: parsed.frontmatter.title ?? id,
      file,
      status: parsed.frontmatter.status,
      lifecycle: parsed.frontmatter.lifecycle,
      priority: parsed.frontmatter.priority,
      tags,
      dependencies: collectDependencyRefs(parsed),
    });
  }

  return items;
};

const items = loadItems();
const byRef = new Map();
for (const item of items) {
  byRef.set(item.id, item);
  byRef.set(item.filenameId, item);
}

const isDependencySatisfied = (dependency) => {
  const item = byRef.get(dependency);
  if (!item) {
    return false;
  }

  return (
    SATISFIED_STATUSES.has(item.status) ||
    (CLOSED_LIFECYCLES.has(item.lifecycle) && item.status !== "ready")
  );
};

const candidates = items
  .filter((item) => path.dirname(item.file) === BACKLOG_DIR)
  .filter((item) => READY_STATUSES.has(item.status))
  .filter((item) => item.lifecycle === undefined || item.lifecycle === "active")
  .filter((item) => item.tags.includes("afk"))
  .filter((item) => !item.tags.includes("hitl"))
  .filter((item) => item.dependencies.every(isDependencySatisfied))
  .map((item) => ({
    id: item.id,
    title: item.title,
    branch: `sandcastle/issue-${item.id}`,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    dependencies: item.dependencies,
    file: item.file,
  }));

process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`);
