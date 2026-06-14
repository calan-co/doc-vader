// backlogIdUtils.ts
// Utility to find the next available numeric id prefix in the backlog directory
import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

const DEFAULT_BACKLOG_DIRECTORY = "./backlog";
const EXCLUDED_BACKLOG_PATH_SEGMENTS = [
  "/archive/",
  "/audit/",
  "/records/",
] as const;

export interface ReadyAfkEligibilityTarget {
  file: string;
  id?: string;
  type?: string;
  subtype?: string;
  lifecycle?: string;
  status?: string;
  tags?: unknown;
  [key: string]: unknown;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0),
  )];
}

function isExcludedBacklogPath(file: string): boolean {
  const posixPath = file.split(path.sep).join("/");
  return EXCLUDED_BACKLOG_PATH_SEGMENTS.some((segment) =>
    posixPath.includes(segment),
  );
}

export function isReadyAfkEligibleWorkItem(
  item: Pick<
    ReadyAfkEligibilityTarget,
    "type" | "status" | "lifecycle" | "tags"
  >,
): boolean {
  if (item.type !== "work-item") {
    return false;
  }

  if ((item.status || "").trim().toLowerCase() !== "ready") {
    return false;
  }

  if ((item.lifecycle || "").trim().toLowerCase() !== "active") {
    return false;
  }

  const tags = normalizeTags(item.tags);
  return tags.includes("afk") && !tags.includes("hitl");
}
/**
 * Finds the next available numeric id prefix in the backlog directory.
 * @param backlogDir Absolute path to the backlog directory
 * @returns The next available id as a number
 */
export function getNextAvailableId(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY
): number {
  const files = fs.readdirSync(backlogDir);
  const idNumbers = files
    .map((file) => {
      // Match leading number before first dot (e.g., 104.move-architecture-docs-task.md)
      const match = file.match(/^(\d+)\./);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((id): id is number => id !== null);
  if (idNumbers.length === 0) return 1;
  return Math.max(...idNumbers) + 1;
}

// Example usage:
// const nextId = getNextAvailableId('/Users/macos/dev/TeamInABox/backlog');
// console.log('Next available backlog id:', nextId);

/**
 * Finds duplicate id prefixes in backlog filenames.
 * @param backlogDir Absolute path to the backlog directory
 * @returns Record of id prefix to array of files
 */
export function findDuplicateIdPrefixes(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY
): Record<string, string[]> {
  const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
  const idMap: Record<string, string[]> = {};
  files.forEach((file) => {
    const match = file.match(/^(\d+)\./);
    if (match) {
      const id = match[1];
      if (!idMap[id]) idMap[id] = [];
      idMap[id].push(file);
    }
  });
  // Only return ids with more than one file, sorted by id then file create date
  const duplicates: Record<string, string[]> = {};
  Object.entries(idMap)
    .sort(([idA], [idB]) => {
      const dateA = fs.statSync(path.join(backlogDir, idMap[idA][0])).birthtime;
      const dateB = fs.statSync(path.join(backlogDir, idMap[idB][0])).birthtime;
      return dateA.getTime() - dateB.getTime();
    })
    .forEach(([id, arr]) => {
      if (arr.length > 1) duplicates[id] = arr;
    });
  return duplicates;
}

/**
 * Renumbers duplicate backlog workitems, updating file names and frontmatter id.
 * @param backlogDir Absolute path to the backlog directory
 * @param duplicates Output of findDuplicateIdPrefixes
 * @returns Map of old file name to new file name
 */
export function renumberDuplicateFiles(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY,
  duplicates: Record<string, string[]>
): Record<string, string> {
  const renameMap: Record<string, string> = {};
  Object.entries(duplicates).forEach(([id, files]) => {
    for (let i = 1; i < files.length; i++) {
      const oldFile = files[i];
      const nextId = getNextAvailableId(backlogDir);
      const newFile = oldFile.replace(/^\d+\./, `${nextId}.`);
      const filePath = path.join(backlogDir, oldFile);
      let content = fs.readFileSync(filePath, "utf8");
      content = content.replace(
        /(^id:\s*["']?)\d+[\w.-]*(["']?)/m,
        `$1${nextId}$2`
      );
      const newFilePath = path.join(backlogDir, newFile);
      fs.writeFileSync(newFilePath, content, "utf8");
      fs.unlinkSync(filePath);
      renameMap[oldFile] = newFile;
    }
  });
  return renameMap;
}

/**
 * Updates any links fields in other backlog files to reference the new file name.
 * @param backlogDir Absolute path to the backlog directory
 * @param renameMap Map of old file name to new file name
 */
export function updateBacklogLinks(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY,
  renameMap: Record<string, string>
): void {
  const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
  files.forEach((file) => {
    const filePath = path.join(backlogDir, file);
    let content = fs.readFileSync(filePath, "utf8");
    Object.entries(renameMap).forEach(([oldFile, newFile]) => {
      const oldLink = oldFile.replace(/\.md$/, "");
      const newLink = newFile.replace(/\.md$/, "");
      const linkRegex = new RegExp(
        `(links:\s*\n(?:[ \t]*-\s*)*)${oldLink}(\b)`,
        "g"
      );
      content = content.replace(linkRegex, `$1${newLink}$2`);
    });
    fs.writeFileSync(filePath, content, "utf8");
  });
}

/**
 * Composite function: finds, renumbers, and updates links for duplicate backlog workitems.
 * @param backlogDir Absolute path to the backlog directory
 */
export function renumberDuplicateBacklogItems(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY
): void {
  const duplicates = findDuplicateIdPrefixes(backlogDir);
  if (Object.keys(duplicates).length === 0) return;
  const renameMap = renumberDuplicateFiles(backlogDir, duplicates);
  updateBacklogLinks(backlogDir, renameMap);
}

// List all markdown files with frontmatter type 'work-item', optionally filter by subtype
export async function list(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY,
  subtype?: string
): Promise<
  Array<{ file: string; type: string; subtype?: string; [key: string]: any }>
> {
  async function findMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findMarkdownFiles(full)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
    return files;
  }

  const files = await findMarkdownFiles(backlogDir);
  const results: Array<{
    file: string;
    type: string;
    subtype?: string;
    [key: string]: any;
  }> = [];
  for (const file of files) {
    const raw = await fs.promises.readFile(file, "utf8");
    const { data } = matter(raw);
    if (data?.type === "work-item") {
      if (!subtype || data.subtype === subtype) {
        results.push({ file, type: data.type, subtype: data.subtype, ...data });
      }
    }
  }
  return results;
}

export async function findReadyAfkEligibleWorkItems(
  backlogDir: string = DEFAULT_BACKLOG_DIRECTORY,
): Promise<Array<ReadyAfkEligibilityTarget>> {
  const items = await list(backlogDir);
  return items.filter((item) => {
    return !isExcludedBacklogPath(item.file) && isReadyAfkEligibleWorkItem(item);
  });
}
