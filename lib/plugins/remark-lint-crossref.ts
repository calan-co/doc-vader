import fs from "fs";
import path from "path";
import {
  createSyntaxRegistry,
  gfmSyntax,
  parseLink,
  type Ast,
  type FileIndex,
  type ParseContext,
  type Syntax,
  urlSyntax,
  wikilinkSyntax,
} from "linkity";
import type { Root } from "mdast";
import { Plugin } from "unified";
import { visitParents } from "unist-util-visit-parents";
import { z } from "zod";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  rootDir: z.string().optional(),
});

export type Options = z.input<typeof optionsSchema>;

type MarkdownIndexEntry = NonNullable<FileIndex["files"]>[number] & {
  absolutePath: string;
  anchors: Set<string>;
};

type MarkdownIndex = {
  byKey: Map<string, MarkdownIndexEntry>;
  byPath: Map<string, MarkdownIndexEntry>;
  byRelativePath: Map<string, MarkdownIndexEntry>;
  fileIndex: FileIndex;
};

const ignoredDirectoryNames = new Set([".git", "node_modules", "dist", "coverage"]);
const syntaxRegistry = createSyntaxRegistry([gfmSyntax, wikilinkSyntax, urlSyntax]);
const syntaxes = syntaxRegistry.list();

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
      if (!ignoredDirectoryNames.has(entry.name)) files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function readIndexEntry(rootDir: string, filePath: string): MarkdownIndexEntry {
  const content = fs.readFileSync(filePath, "utf8");
  const anchors = new Set<string>();
  const id = content.match(/^id:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
  const title = content.match(/^title:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim();
  if (id) anchors.add(id);
  const headingCounts = new Map<string, number>();
  for (const match of content.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    if (!match[1]) continue;
    const base = slug(match[1]);
    const count = headingCounts.get(base) ?? 0;
    anchors.add(count ? `${base}-${count}` : base);
    headingCounts.set(base, count + 1);
  }
  for (const match of content.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) anchors.add(match[1]);
  }

  return {
    path: path.relative(rootDir, filePath).replaceAll(path.sep, "/"),
    absolutePath: filePath,
    ...(title ? { title } : {}),
    ...(id ? { aliases: [id] } : {}),
    headings: [...anchors],
    anchors,
  };
}

function decodeTargetComponent(value: string): string {
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
    target: decodeTargetComponent(withoutQuery),
    fragment: decodeTargetComponent(afterHash),
  };
}

function fileIndexFor(entries: MarkdownIndexEntry[]): FileIndex {
  const byRelativePath = new Map(entries.map((entry) => [entry.path, entry]));
  return {
    files: entries,
    resolvePath(target, sourcePath) {
      const { target: targetPath } = splitTarget(target);
      const baseDir = sourcePath ? path.posix.dirname(sourcePath) : "";
      const rootRelative = /^(backlog|docs|templates)\//.test(targetPath);
      const relativePath = rootRelative ? targetPath : path.posix.join(baseDir, targetPath);
      const normalizedPath = path.posix.normalize(relativePath).replace(/^\.\//, "");
      return byRelativePath.get(normalizedPath)?.path ?? byRelativePath.get(`${normalizedPath}.md`)?.path;
    },
  };
}

function markdownIndex(rootDir: string): MarkdownIndex {
  const root = path.resolve(rootDir);
  const byKey = new Map<string, MarkdownIndexEntry>();
  const byPath = new Map<string, MarkdownIndexEntry>();
  const entries = walkMarkdownFiles(root).map((filePath) => readIndexEntry(root, filePath));
  for (const entry of entries) {
    byPath.set(path.resolve(entry.absolutePath), entry);
    byKey.set(entry.path, entry);
    byKey.set(entry.path.replace(/\.md$/i, ""), entry);
    byKey.set(path.basename(entry.path, ".md"), entry);
    for (const alias of entry.aliases ?? []) byKey.set(alias, entry);
  }

  return {
    byKey,
    byPath,
    byRelativePath: new Map(entries.map((entry) => [entry.path, entry])),
    fileIndex: fileIndexFor(entries),
  };
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

function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function pathTarget(ast: Ast): string {
  if (!ast.path) return "";
  const separator = ast.path.separator ?? "/";
  const parts = [...(ast.path.containers ?? [])];
  const resource = `${ast.path.resource ?? ""}${ast.path.extension ? `.${ast.path.extension}` : ""}`;
  if (resource) parts.push(resource);
  return `${ast.path.absolute ? separator : ""}${parts.join(separator)}`;
}

function rawTarget(ast: Ast): string {
  const authority = ast.scheme ? `${ast.scheme}://${ast.authority ?? ""}` : "";
  const query = ast.query
    ? `?${Object.entries(ast.query)
        .flatMap(([key, value]) =>
          Array.isArray(value)
            ? value.map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
            : [value === true ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`],
        )
        .join("&")}`
    : "";
  const fragment = ast.block ? `#^${ast.block}` : ast.anchor ? `#${ast.anchor}` : "";
  return `${authority}${pathTarget(ast)}${query}${fragment}`;
}

function parseDocumentLinks(markdown: string, context: ParseContext): Ast[] {
  const links: Ast[] = [];
  let startIndex = 0;

  while (startIndex < markdown.length) {
    const candidate = syntaxes
      .map((syntax) => ({ syntax, match: syntax.match(markdown, { startIndex }) }))
      .filter((candidate): candidate is { syntax: Syntax; match: NonNullable<typeof candidate.match> } => Boolean(candidate.match))
      .sort((left, right) => left.match.span.start - right.match.span.start)[0];
    if (!candidate) break;

    const raw = candidate.match.raw;
    try {
      links.push({ ...parseLink(raw, candidate.syntax, context), span: candidate.match.span });
    } catch {
      links.push({ ...parseLink(raw, candidate.syntax), span: candidate.match.span });
    }
    const nextIndex = candidate.match.span.end;
    startIndex = nextIndex > startIndex ? nextIndex : startIndex + 1;
  }

  return links;
}

function indexedPath(index: MarkdownIndex, filePath: string): MarkdownIndexEntry | undefined {
  return index.byPath.get(filePath) ?? index.byPath.get(`${filePath}.md`);
}

function resolveTarget(ast: Ast, sourcePath: string, rootDir: string, index: MarkdownIndex) {
  const raw = rawTarget(ast).trim();
  if (!raw || ast.scheme || hasScheme(raw)) return { kind: "external" } as const;
  if (/{{|}}|<%|%>|\$\{/.test(raw)) return { kind: "template-target", raw } as const;

  const { target, fragment } = splitTarget(raw);
  if (target.split(/[\\/]/).some((segment) => ignoredDirectoryNames.has(segment))) {
    return { kind: "ignored-target", raw } as const;
  }
  if (!target && fragment) {
    return { kind: "resolved", entry: index.byPath.get(path.resolve(sourcePath)), fragment, raw } as const;
  }

  const rootRelative = /^(backlog|docs|templates)\//.test(target);
  const targetPath = path.resolve(rootRelative ? rootDir : path.dirname(sourcePath || rootDir), target);
  if (target.endsWith(".graph.json") && fs.existsSync(targetPath)) {
    return { kind: "generated-target", raw } as const;
  }
  if (target && !target.endsWith(".md") && !target.endsWith(".graph.json") && ast.provenance?.syntax === gfmSyntax.id && path.extname(target)) {
    return { kind: "external" } as const;
  }

  const sourceRelativePath = sourcePath ? path.relative(rootDir, sourcePath).replaceAll(path.sep, "/") : undefined;
  const resolvedPath = index.fileIndex.resolvePath?.(target, sourceRelativePath);
  const entry = resolvedPath
    ? index.byRelativePath.get(resolvedPath)
    : ast.provenance?.syntax !== wikilinkSyntax.id
      ? undefined
      : target.includes("/")
        ? indexedPath(index, path.resolve(rootDir, target))
        : index.byKey.get(target.replace(/\.md$/i, "")) ?? index.byKey.get(target);
  return { kind: "resolved", entry, fragment, raw } as const;
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
    const context = {
      sourcePath: sourcePath ? path.relative(rootDir, sourcePath).replaceAll(path.sep, "/") : undefined,
      fileIndex: index.fileIndex,
    };

    for (const link of parseDocumentLinks(markdown, context)) {
      if (inRange(link.span?.start, codeRanges)) continue;
      const resolved = resolveTarget(link, sourcePath, rootDir, index);
      if (resolved.kind === "external") continue;
      const point = pointForOffset(markdown, link.span?.start);
      const target = rawTarget(link);
      if (resolved.kind === "template-target" || resolved.kind === "generated-target" || resolved.kind === "ignored-target") {
        emit(`Linkity ${resolved.kind}: ${target}`, point);
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
