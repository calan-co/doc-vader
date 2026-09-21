import { promises as fs } from "node:fs";
import path from "node:path";
import { isMap, parseDocument } from "yaml";
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

function assertSafeRecipePath(candidate: string): void {
  const parts = candidate.split(/[\\/]/);
  if (!candidate || path.isAbsolute(candidate) || parts.includes(".") || parts.includes("..") || parts.includes(".git")) {
    throw new InitError(`Unsafe init path: ${candidate}`);
  }
}

function safePath(rootDir: string, candidate: string): string {
  assertSafeRecipePath(candidate);
  const absolute = path.resolve(rootDir, candidate);
  if (path.relative(rootDir, absolute).startsWith("..")) throw new InitError(`Unsafe init path: ${candidate}`);
  return absolute;
}

async function assertNoSymlinkEscape(rootDir: string, target: string): Promise<void> {
  const resolvedRoot = await fs.realpath(rootDir);
  let ancestor = path.dirname(target);
  while (true) {
    try {
      const resolved = await fs.realpath(ancestor);
      if (path.relative(resolvedRoot, resolved).startsWith("..")) {
        throw new InitError(`Init path escapes through a symlink: ${target}`);
      }
      return;
    } catch (error) {
      if (error instanceof InitError) throw error;
      if (ancestor === rootDir) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

function validateRecipe(recipe: InitRecipe): void {
  const outputPaths = new Set<string>();
  for (const output of recipe.outputs) {
    assertSafeRecipePath(output.path);
    if (outputPaths.has(output.path)) throw new InitError(`Duplicate init output: ${output.path}`);
    outputPaths.add(output.path);
  }
  if (!recipe.config) return;
  const claims = new Set(recipe.config.claims);
  const valueLeaves = leaves(recipe.config.values);
  if (claims.size !== recipe.config.claims.length || valueLeaves.length !== claims.size || valueLeaves.some((key) => !claims.has(key))) {
    throw new InitError("Init config values must exactly match declared claims.");
  }
  if (outputPaths.has("dv.yaml")) throw new InitError("Init config and output paths collide: dv.yaml");
}

function validateSelection(packs: readonly InitPack[]): void {
  const claimed = new Set<string>();
  const outputs = new Set<string>();
  for (const pack of packs) {
    validateRecipe(pack.init);
    for (const output of pack.init.outputs) {
      if (outputs.has(output.path)) throw new InitError(`Selected packs collide at ${output.path}`);
      outputs.add(output.path);
    }
    for (const claim of pack.init.config?.claims ?? []) {
      if (claimed.has(claim)) throw new InitError(`Selected packs claim the same config path: ${claim}`);
      claimed.add(claim);
    }
  }
}

async function writeConfig(rootDir: string, config: NonNullable<InitRecipe["config"]>): Promise<void> {
  const configPath = path.join(rootDir, "dv.yaml");
  const source = await fs.readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const document = parseDocument(source);
  if (document.errors.length || (document.contents && !isMap(document.contents))) {
    throw new InitError("dv.yaml must contain a YAML mapping.");
  }
  for (const claim of config.claims) {
    const keys = claim.split(".");
    let value: unknown = config.values;
    for (const key of keys) value = (value as Record<string, unknown>)[key];
    document.setIn(keys, value);
  }
  await fs.writeFile(configPath, document.toString(), "utf8");
}

type ManagedChange = { path: string; previous?: Buffer };

async function writeManaged(pathname: string, content: string, changes: ManagedChange[]): Promise<void> {
  const previous = await fs.readFile(pathname).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  changes.push({ path: pathname, previous });
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, content, "utf8");
}

async function rollback(changes: readonly ManagedChange[]): Promise<void> {
  for (const change of [...changes].reverse()) {
    if (change.previous === undefined) await fs.rm(change.path, { force: true });
    else await fs.writeFile(change.path, change.previous);
  }
}

async function applyPack(rootDir: string, pack: InitPack): Promise<void> {
  const changes: ManagedChange[] = [];
  try {
    for (const output of pack.init.outputs) {
      const target = safePath(rootDir, output.path);
      await assertNoSymlinkEscape(rootDir, target);
      await writeManaged(target, output.content, changes);
    }
    if (pack.init.config) {
      const configPath = path.join(rootDir, "dv.yaml");
      await assertNoSymlinkEscape(rootDir, configPath);
      const previous = await fs.readFile(configPath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
      changes.push({ path: configPath, previous });
      await writeConfig(rootDir, pack.init.config);
    }
  } catch (error) {
    await rollback(changes);
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
    for (const descriptor of metadata?.docVader?.documentTypePacks ?? []) {
      if (!descriptor || typeof descriptor.id !== "string" || typeof descriptor.manifest !== "string") continue;
      const manifestPath = safePath(packageRoot, descriptor.manifest);
      const manifest = await fs.readFile(manifestPath, "utf8").then(JSON.parse).catch(() => undefined) as { schemaVersion?: unknown; namespace?: unknown; documentTypes?: unknown; name?: unknown; init?: unknown } | undefined;
      if (isDocumentTypePack(manifest) && typeof manifest.name === "string" && isRecipe(manifest.init)) {
        packs.push({ id: descriptor.id, name: manifest.name, init: manifest.init });
      }
    }
  }
  return packs;
}

function isDocumentTypePack(value: { schemaVersion?: unknown; namespace?: unknown; documentTypes?: unknown; name?: unknown; init?: unknown } | undefined): value is { schemaVersion: "doc-vader/document-type-pack/v1"; namespace: string; documentTypes: unknown[]; name?: unknown; init?: unknown } {
  return value?.schemaVersion === "doc-vader/document-type-pack/v1" &&
    typeof value.namespace === "string" && Array.isArray(value.documentTypes) && value.documentTypes.length > 0;
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
  const rootDir = resolveGitRoot(options.dir);
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
