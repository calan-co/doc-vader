import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { isMap, parseDocument, stringify } from "yaml";
import { resolveGitRoot } from "../task/authority.js";

export interface InitPrompt {
  isTTY: boolean;
  select(packs: readonly InitPack[]): Promise<string[]>;
  confirm(packs: readonly InitPack[]): Promise<boolean>;
}

export interface InitPack {
  id: string;
  name: string;
  init: InitRecipe;
}

export interface InitRecipe {
  outputs: Array<{ path: string; content: string }>;
  config?: { claims: string[]; values: Record<string, unknown> };
}

export interface InitResult {
  rootDir: string;
  dryRun: boolean;
  planned: string[];
  applied: string[];
  failed: Array<{ pack: string; error: string }>;
}

export class InitError extends Error {}

const documentTypePackSchemaPath = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas/doc-vader/document-type-pack.json"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../schemas/doc-vader/document-type-pack.json"),
].find(existsSync);

if (!documentTypePackSchemaPath) {
  throw new Error("Document-type-pack schema is unavailable.");
}

const documentTypePackAjv = new Ajv2020({ allErrors: true, strict: false });
documentTypePackAjv.addSchema(
  JSON.parse(readFileSync(path.join(path.dirname(documentTypePackSchemaPath), "config.json"), "utf8")),
  "/doc-vader/config",
);
const validateDocumentTypePackSchema = documentTypePackAjv.compile(
  JSON.parse(readFileSync(documentTypePackSchemaPath, "utf8")),
);

const WORK_DOCUMENT_TYPE_PACK = {
  schemaVersion: "doc-vader/document-type-pack/v1",
  name: "Work management",
  namespace: "doc-vader.work-management",
  documentTypes: [{
    type: "work-item",
    metadataSchema: "schemas/work-management/frontmatter/work-item.json",
  }],
  init: {
    outputs: [{ path: "backlog/.gitkeep", content: "" }],
    config: { claims: ["backlog.dir"], values: { backlog: { dir: "backlog" } } },
  },
};

const BUILTIN_PACKS: readonly InitPack[] = [{
  id: "work",
  name: WORK_DOCUMENT_TYPE_PACK.name,
  init: WORK_DOCUMENT_TYPE_PACK.init,
}];

function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

function canonicalRecipePath(candidate: string): string {
  const normalized = path.posix.normalize(candidate.replaceAll("\\", "/"));
  const parts = candidate.split(/[\\/]/);
  if (!candidate || path.isAbsolute(candidate) || normalized === "." || normalized.startsWith("../") || parts.includes(".") || parts.includes("..") || parts.some((part) => part.toLowerCase() === ".git")) {
    throw new InitError(`Unsafe init path: ${candidate}`);
  }
  return normalized;
}

function safePath(rootDir: string, candidate: string): string {
  const normalized = canonicalRecipePath(candidate);
  const absolute = path.resolve(rootDir, normalized);
  if (path.relative(rootDir, absolute).startsWith("..")) throw new InitError(`Unsafe init path: ${candidate}`);
  return absolute;
}

async function assertNoSymlinkEscape(rootDir: string, target: string): Promise<void> {
  if ((await fs.lstat(rootDir)).isSymbolicLink()) {
    throw new InitError(`Init path escapes through a symlink: ${target}`);
  }
  const relative = path.relative(rootDir, target);
  let current = rootDir;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new InitError(`Init path escapes through a symlink: ${target}`);
      }
    } catch (error) {
      if (error instanceof InitError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function outputPathsConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateRecipe(recipe: InitRecipe): void {
  const outputPaths: string[] = [];
  for (const output of recipe.outputs) {
    const outputPath = canonicalRecipePath(output.path);
    if (outputPaths.some((existing) => outputPathsConflict(existing, outputPath))) {
      throw new InitError(`Conflicting init output: ${output.path}`);
    }
    if (outputPath.toLowerCase() === "dv.yaml" || outputPath.toLowerCase().startsWith("dv.yaml/")) {
      throw new InitError("Init config and output paths collide: dv.yaml");
    }
    outputPaths.push(outputPath);
  }
  if (!recipe.config) return;
  const claims = new Set(recipe.config.claims);
  const valueLeaves = leaves(recipe.config.values);
  if (claims.size !== recipe.config.claims.length || valueLeaves.length !== claims.size || valueLeaves.some((key) => !claims.has(key))) {
    throw new InitError("Init config values must exactly match declared claims.");
  }
}

function validateSelection(packs: readonly InitPack[]): void {
  const claimed = new Set<string>();
  const outputs: string[] = [];
  for (const pack of packs) {
    validateRecipe(pack.init);
    for (const output of pack.init.outputs) {
      const outputPath = canonicalRecipePath(output.path);
      if (outputs.some((existing) => outputPathsConflict(existing, outputPath))) {
        throw new InitError(`Selected packs collide at ${output.path}`);
      }
      outputs.push(outputPath);
    }
    for (const claim of pack.init.config?.claims ?? []) {
      if (claimed.has(claim)) throw new InitError(`Selected packs claim the same config path: ${claim}`);
      claimed.add(claim);
    }
  }
}

function yamlValue(value: unknown): string {
  return stringify(value).trimEnd();
}

async function writeConfig(rootDir: string, config: NonNullable<InitRecipe["config"]>): Promise<void> {
  const configPath = path.join(rootDir, "dv.yaml");
  const source = await fs.readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length || (document.contents && !isMap(document.contents))) {
    throw new InitError("dv.yaml must contain a YAML mapping.");
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const missingRoots = new Set<string>();
  for (const claim of config.claims) {
    const keys = claim.split(".");
    let value: unknown = config.values;
    for (const key of keys) value = (value as Record<string, unknown>)[key];
    const existing = document.getIn(keys, true);
    const range = typeof existing === "object" && existing !== null
      ? (existing as { range?: [number, number] }).range
      : undefined;
    if (range) {
      edits.push({ start: range[0], end: range[1], text: yamlValue(value) });
      continue;
    }
    const parent = document.getIn(keys.slice(0, -1), true);
    if (parent === undefined) {
      missingRoots.add(keys[0]!);
      continue;
    }
    if (!isMap(parent) || !parent.range) {
      throw new InitError(`Init config claim cannot be added: ${claim}`);
    }
    if (parent.flow) {
      const closingBrace = source.lastIndexOf("}", parent.range[1] - 1);
      if (closingBrace < parent.range[0]) throw new InitError(`Init config claim cannot be added: ${claim}`);
      edits.push({ start: closingBrace, end: closingBrace, text: `${parent.items.length ? "," : ""} ${keys.at(-1)}: ${yamlValue(value)}` });
      continue;
    }
    const indent = (parent.srcToken as { indent?: number } | undefined)?.indent ?? 0;
    const prefix = source.slice(0, parent.range[1]).endsWith("\n") ? "" : "\n";
    edits.push({ start: parent.range[1], end: parent.range[1], text: `${prefix}${" ".repeat(indent)}${keys.at(-1)}: ${yamlValue(value)}\n` });
  }
  for (const root of missingRoots) {
    const value = config.values[root];
    edits.push({ start: source.length, end: source.length, text: `${source && !source.endsWith("\n") ? "\n" : ""}${yamlValue({ [root]: value })}\n` });
  }
  const updated = edits.sort((left, right) => right.start - left.start)
    .reduce((text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`, source);
  await fs.writeFile(configPath, updated, "utf8");
}

type ManagedChange = { path: string; previous?: Buffer };

async function ensureParentDirectories(rootDir: string, pathname: string, createdDirectories: string[]): Promise<void> {
  const missing: string[] = [];
  for (let current = path.dirname(pathname); current !== rootDir; current = path.dirname(current)) {
    try {
      await fs.lstat(current);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(current);
    }
  }
  for (const directory of missing.reverse()) {
    await fs.mkdir(directory);
    createdDirectories.push(directory);
  }
}

async function writeManaged(rootDir: string, pathname: string, content: string, changes: ManagedChange[], createdDirectories: string[]): Promise<void> {
  const previous = await fs.readFile(pathname).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  changes.push({ path: pathname, previous });
  await ensureParentDirectories(rootDir, pathname, createdDirectories);
  await fs.writeFile(pathname, content, "utf8");
}

async function rollback(changes: readonly ManagedChange[], createdDirectories: readonly string[]): Promise<void> {
  for (const change of [...changes].reverse()) {
    if (change.previous === undefined) await fs.rm(change.path, { force: true });
    else await fs.writeFile(change.path, change.previous);
  }
  for (const directory of [...createdDirectories].reverse()) {
    await fs.rmdir(directory).catch(() => undefined);
  }
}

async function applyPack(rootDir: string, pack: InitPack): Promise<void> {
  const changes: ManagedChange[] = [];
  const createdDirectories: string[] = [];
  try {
    for (const output of pack.init.outputs) {
      const target = safePath(rootDir, output.path);
      await assertNoSymlinkEscape(rootDir, target);
      await writeManaged(rootDir, target, output.content, changes, createdDirectories);
    }
    if (pack.init.config) {
      const configPath = path.join(rootDir, "dv.yaml");
      await assertNoSymlinkEscape(rootDir, configPath);
      const previous = await fs.readFile(configPath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
      changes.push({ path: configPath, previous });
      await writeConfig(rootDir, pack.init.config);
    }
  } catch (error) {
    await rollback(changes, createdDirectories);
    throw error;
  }
}

export async function installedInitPacks(rootDir: string): Promise<InitPack[]> {
  const nodeModules = path.join(rootDir, "node_modules");
  const entries = await fs.readdir(nodeModules, { withFileTypes: true }).catch(() => []);
  const packageDirs = entries.flatMap((entry) => entry.name.startsWith("@") ? [] : [entry.name]);
  for (const scope of entries.filter((entry) => entry.name.startsWith("@") && entry.isDirectory())) {
    const scoped = await fs.readdir(path.join(nodeModules, scope.name), { withFileTypes: true }).catch(() => []);
    packageDirs.push(...scoped.filter((entry) => entry.isDirectory()).map((entry) => `${scope.name}/${entry.name}`));
  }
  const packs: InitPack[] = [];
  for (const packageDir of packageDirs) {
    const packageRoot = path.join(nodeModules, packageDir);
    const metadata = await fs.readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse).catch(() => undefined) as { docVader?: { documentTypePacks?: Array<{ id: string; manifest: string }> } } | undefined;
    const descriptors = metadata?.docVader && Array.isArray(metadata.docVader.documentTypePacks)
      ? metadata.docVader.documentTypePacks
      : [];
    for (const descriptor of descriptors) {
      if (!descriptor || typeof descriptor.id !== "string" || typeof descriptor.manifest !== "string") continue;
      let manifestPath: string;
      try {
        manifestPath = safePath(packageRoot, descriptor.manifest);
        await assertNoSymlinkEscape(packageRoot, manifestPath);
      } catch {
        continue;
      }
      const manifest = await fs.readFile(manifestPath, "utf8").then(JSON.parse).catch(() => undefined) as unknown;
      if (isDocumentTypePack(manifest) && typeof manifest.name === "string" && isRecipe(manifest.init)) {
        packs.push({ id: descriptor.id, name: manifest.name, init: manifest.init });
      }
    }
  }
  return packs;
}

function isDocumentTypePack(value: unknown): value is { name?: unknown; init?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    validateDocumentTypePackSchema(value);
}

function isRecipe(value: unknown): value is InitRecipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Partial<InitRecipe>;
  return Array.isArray(recipe.outputs) && recipe.outputs.every((output) => Boolean(output) && typeof output.path === "string" && typeof output.content === "string") &&
    (!recipe.config || Array.isArray(recipe.config.claims) && recipe.config.claims.every((claim) => typeof claim === "string") && typeof recipe.config.values === "object" && recipe.config.values !== null);
}

export async function availableInitPacks(rootDir: string): Promise<InitPack[]> {
  return [...BUILTIN_PACKS, ...await installedInitPacks(rootDir)];
}

export async function runInit(options: {
  dir?: string;
  packIds?: string[];
  yes?: boolean;
  dryRun?: boolean;
  prompt: InitPrompt;
}): Promise<InitResult> {
  const rootDir = options.dir ? path.resolve(options.dir) : resolveGitRoot();
  const available = await availableInitPacks(rootDir);
  let packIds = options.packIds ?? [];
  if (packIds.length === 0) {
    if (!options.prompt.isTTY) throw new InitError("--pack is required outside an interactive terminal.");
    packIds = await options.prompt.select(available);
  }
  const selected = packIds.map((id) => available.find((pack) => pack.id === id) ?? (() => { throw new InitError(`Unknown init pack: ${id}`); })());
  validateSelection(selected);
  if (!options.yes && !options.dryRun && !options.prompt.isTTY) {
    throw new InitError("--yes is required outside an interactive terminal.");
  }
  if (!options.yes && !options.dryRun && !(await options.prompt.confirm(selected))) {
    return { rootDir, dryRun: false, planned: selected.map((pack) => pack.id), applied: [], failed: [] };
  }
  if (options.dryRun) return { rootDir, dryRun: true, planned: selected.map((pack) => pack.id), applied: [], failed: [] };
  const applied: string[] = [];
  const failed: Array<{ pack: string; error: string }> = [];
  for (const pack of selected) {
    try {
      await applyPack(rootDir, pack);
      applied.push(pack.id);
    } catch (error) {
      failed.push({ pack: pack.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { rootDir, dryRun: false, planned: selected.map((pack) => pack.id), applied, failed };
}
