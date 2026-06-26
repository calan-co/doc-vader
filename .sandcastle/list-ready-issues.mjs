#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const BACKLOG_DIR = "backlog";
const ARCHIVE_DIR = path.join(BACKLOG_DIR, "archive");
const WORKTREE_DIR = path.join(".sandcastle", "worktrees");
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

const readWorktreeDirs = () =>
  fs.existsSync(WORKTREE_DIR)
    ? fs
        .readdirSync(WORKTREE_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(WORKTREE_DIR, entry.name))
        .sort()
    : [];

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

const checklistState = (body, heading) => {
  const section = extractSection(body, heading);
  const checked = [...section.matchAll(/^\s*-\s*\[[xX]\]\s+/gm)].length;
  const unchecked = [...section.matchAll(/^\s*-\s*\[\s\]\s+/gm)].length;

  return { checked, unchecked };
};

const hasCompletedChecklistEvidence = (body) => {
  for (const heading of ["Tasks", "Acceptance Criteria"]) {
    const { checked, unchecked } = checklistState(body, heading);
    if (checked === 0 || unchecked > 0) {
      return false;
    }
  }

  return true;
};

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

  return [...new Set([...dependencyRefs].map(normalizeRef))];
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
      checklistsComplete: hasCompletedChecklistEvidence(parsed.body),
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

const dirtyWorktrees = new Map();
for (const worktree of readWorktreeDirs()) {
  const branch = execFileSync("git", ["-C", worktree, "branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["-C", worktree, "status", "--porcelain"], {
    encoding: "utf8",
  }).trim();

  if (status === "") {
    continue;
  }

  const id = normalizeRef(branch.replace(/^sandcastle\/issue-/, ""));
  dirtyWorktrees.set(id, { branch, worktree });
}

const isDependencySatisfied = (dependency) => {
  if (dirtyWorktrees.has(dependency)) {
    return false;
  }

  const item = byRef.get(dependency);
  if (!item) {
    return false;
  }

  return (
    (SATISFIED_STATUSES.has(item.status) && item.checklistsComplete) ||
    (CLOSED_LIFECYCLES.has(item.lifecycle) && item.status !== "ready")
  );
};

const isSatisfiedItem = (item) =>
  (SATISFIED_STATUSES.has(item.status) && item.checklistsComplete) ||
  (CLOSED_LIFECYCLES.has(item.lifecycle) && item.status !== "ready");

const isActiveBacklogItem = (item) =>
  path.dirname(item.file) === BACKLOG_DIR &&
  (item.lifecycle === undefined || item.lifecycle === "active") &&
  item.tags.includes("afk") &&
  !item.tags.includes("hitl");

const branchExists = (branch) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const readBranchItem = (item) => {
  const branch = `sandcastle/issue-${item.id}`;
  if (!branchExists(branch)) {
    return undefined;
  }

  try {
    const content = execFileSync("git", ["show", `${branch}:${item.file}`], {
      encoding: "utf8",
    });
    const parsed = parseFrontmatter(content, `${branch}:${item.file}`);

    return {
      branch,
      status: parsed.frontmatter.status,
      lifecycle: parsed.frontmatter.lifecycle,
      checklistsComplete: hasCompletedChecklistEvidence(parsed.body),
    };
  } catch {
    return {
      branch,
      status: "unknown",
      lifecycle: "unknown",
      checklistsComplete: false,
    };
  }
};

const branchItems = new Map(
  items
    .map((item) => [item.id, readBranchItem(item)])
    .filter(([, item]) => item),
);

const branchAllowsPlanning = (item) => {
  const branchItem = branchItems.get(item.id);
  if (!branchItem) {
    return true;
  }

  return READY_STATUSES.has(branchItem.status);
};

const candidates = items
  .filter(isActiveBacklogItem)
  .filter(branchAllowsPlanning)
  .filter(
    (item) =>
      READY_STATUSES.has(item.status) ||
      (dirtyWorktrees.has(item.id) && !isSatisfiedItem(item)),
  )
  .filter((item) => item.lifecycle === undefined || item.lifecycle === "active")
  .filter((item) => item.dependencies.every(isDependencySatisfied))
  .map((item) => ({
    id: item.id,
    title: item.title,
    branch:
      dirtyWorktrees.get(item.id)?.branch ?? `sandcastle/issue-${item.id}`,
    mode: dirtyWorktrees.has(item.id) ? "recovery" : "fresh",
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    dependencies: item.dependencies,
    file: item.file,
  }));

process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`);
