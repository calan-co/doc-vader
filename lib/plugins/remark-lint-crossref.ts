import fs from "fs";
import path from "path";
import { parseLinks, type LinkNode } from "linkity";
import type { Root } from "mdast";
import { Plugin } from "unified";
import { visitParents } from "unist-util-visit-parents";
import { z } from "zod";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  rootDir: z.string().optional(),
});

export type Options = z.input<typeof optionsSchema>;

type MarkdownIndexEntry = {
  path: string;
  id?: string;
  anchors: Set<string>;
};

type MarkdownIndex = {
  byKey: Map<string, MarkdownIndexEntry>;
  byPath: Map<string, MarkdownIndexEntry>;
};

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);
const indexCache = new Map<string, MarkdownIndex>();

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function walkMarkdownFiles(dir: string): string[] {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isIgnoredPath(rootDir: string, filePath: string): boolean {
  return path.relative(rootDir, filePath).split(path.sep).some((part) => IGNORED_DIRS.has(part));
}

function readMarkdownMetadata(filePath: string): { id?: string; anchors: Set<string> } {
  const content = fs.readFileSync(filePath, "utf8");
  const anchors = new Set<string>();
  const id = content.match(/^id:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
  if (id) anchors.add(id);
  for (const match of content.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    if (match[1]) anchors.add(slug(match[1]));
  }
  for (const match of content.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) anchors.add(match[1]);
  }
  return { id, anchors };
}

function markdownIndex(rootDir: string): MarkdownIndex {
  const key = path.resolve(rootDir);
  const cached = indexCache.get(key);
  if (cached) return cached;

  const byKey = new Map<string, MarkdownIndexEntry>();
  const byPath = new Map<string, MarkdownIndexEntry>();
  for (const filePath of walkMarkdownFiles(key)) {
    const relative = path.relative(key, filePath).replaceAll(path.sep, "/");
    const entry = { path: filePath, ...readMarkdownMetadata(filePath) };
    byPath.set(path.resolve(filePath), entry);
    byKey.set(relative, entry);
    byKey.set(relative.replace(/\.md$/i, ""), entry);
    byKey.set(path.basename(relative, ".md"), entry);
    if (entry.id) byKey.set(entry.id, entry);
  }

  const index = { byKey, byPath };
  indexCache.set(key, index);
  return index;
}

function pointForOffset(value: string, offset = 0) {
  const prefix = value.slice(0, Math.max(0, offset));
  const lines = prefix.split("\n");
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

function collectCodeRanges(tree: Root, markdown: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const type of ["code", "inlineCode"]) {
    visitParents(tree, type, (node: any) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number") ranges.push({ start, end });
    });
  }
  for (const match of markdown.matchAll(/`[^`\n]+`/g)) {
    ranges.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return ranges;
}

function inRange(offset: number | undefined, ranges: Array<{ start: number; end: number }>): boolean {
  return typeof offset === "number" && ranges.some((range) => offset >= range.start && offset < range.end);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitTarget(rawTarget: string): { target: string; fragment: string } {
  const [beforeHash = "", afterHash = ""] = rawTarget.split("#", 2);
  const [withoutQuery = ""] = beforeHash.split("?", 1);
  return {
    target: safeDecode(withoutQuery),
    fragment: safeDecode(afterHash),
  };
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function rawTarget(node: LinkNode): string {
  return node.type === "markdown" ? (node.url ?? "") : node.value;
}

function indexedPath(index: MarkdownIndex, filePath: string): MarkdownIndexEntry | undefined {
  return index.byPath.get(filePath) ?? index.byPath.get(`${filePath}.md`);
}

function resolveTarget(node: LinkNode, sourcePath: string, rootDir: string, index: MarkdownIndex) {
  const raw = rawTarget(node).trim();
  if (!raw || hasScheme(raw)) return { kind: "external" } as const;
  if (/{{|}}|<%|%>|\$\{/.test(raw)) return { kind: "template-target", raw } as const;

  const { target, fragment } = splitTarget(raw);
  if (!target && fragment) {
    return { kind: "resolved", entry: index.byPath.get(path.resolve(sourcePath)), fragment, raw } as const;
  }
  if (target && !target.endsWith(".md") && (node.type === "markdown" || path.extname(target))) {
    return { kind: "external" } as const;
  }

  if (target.startsWith("./") || target.startsWith("../") || target.includes("/")) {
    const rootRelative = /^(backlog|docs|templates)\//.test(target);
    const baseDir = rootRelative ? rootDir : sourcePath ? path.dirname(sourcePath) : rootDir;
    const resolved = path.resolve(baseDir, target);
    if (isIgnoredPath(rootDir, resolved)) return { kind: "ignored-target", raw } as const;
    return { kind: "resolved", entry: indexedPath(index, resolved), fragment, raw } as const;
  }

  return { kind: "resolved", entry: index.byKey.get(target.replace(/\.md$/i, "")) ?? index.byKey.get(target), fragment, raw } as const;
}

const SOURCE = "remark-lint";
const RULE_ID = "crossref";

const remarkLintCrossref = function (options?: Options) {
  return function (tree: Root, file: any) {
    const emit = (messageText: string, point?: { line: number; column: number }, fatal = false) => {
      const message = file.message(messageText, point);
      message.source = SOURCE;
      message.ruleId = RULE_ID;
      message.fatal = fatal;
      return message;
    };

    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      emit(`Invalid remark-lint-crossref options: ${reason}`, undefined, true);
      return;
    }

    if (!parsedOptions.enabled) return;
    const rootDir = path.resolve(parsedOptions.rootDir || process.cwd());
    const sourcePath = file.path ? path.resolve(file.path) : "";
    const markdown = String(file.value ?? "");
    const codeRanges = collectCodeRanges(tree, markdown);
    const index = markdownIndex(rootDir);

    for (const link of parseLinks(markdown, { enableMarkdown: true, enableUrl: true, enableWikilink: true })) {
      if (inRange(link.position?.start, codeRanges)) continue;
      const resolved = resolveTarget(link, sourcePath, rootDir, index);
      if (resolved.kind === "external") continue;
      const point = pointForOffset(markdown, link.position?.start);
      const target = rawTarget(link);
      if (resolved.kind === "template-target") {
        emit(`Linkity template-target: ${target}`, point);
        continue;
      }
      if (resolved.kind === "ignored-target") {
        emit(`Linkity ignored-target: ${target}`, point);
        continue;
      }
      if (!resolved.entry) {
        emit(`Linkity missing-target: ${target}`, point);
        continue;
      }
      if (resolved.fragment && !resolved.entry.anchors.has(slug(resolved.fragment)) && !resolved.entry.anchors.has(resolved.fragment)) {
        emit(`Linkity missing-anchor: ${target}`, point);
      }
    }
  };
} as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintCrossref;
