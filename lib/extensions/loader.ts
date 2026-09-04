import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";

export interface DocVaderExtensionContext {
  cwd: string;
}

export interface DocVaderExtensionModule {
  register?: (program: Command, context: DocVaderExtensionContext) => void | Promise<void>;
  registerDocVaderExtension?: (
    program: Command,
    context: DocVaderExtensionContext,
  ) => void | Promise<void>;
  default?:
    | ((program: Command, context: DocVaderExtensionContext) => void | Promise<void>)
    | DocVaderExtensionModule;
}

interface PackageJsonWithDocVaderExtensions {
  docVader?: {
    extensions?: unknown;
  };
}

export interface InstalledDocVaderExtension {
  name: string;
  packageName: string;
  packageSpecifier: string;
  entrypoint: string;
  enabled: boolean;
  installedAt: string;
}

export interface DocVaderExtensionManifest {
  schemaVersion: "doc-vader/extensions/v1";
  extensions: InstalledDocVaderExtension[];
}

export interface InstallDocVaderExtensionOptions {
  cwd?: string;
  enabled?: boolean;
  name?: string;
  validate?: boolean;
}

export interface UninstallDocVaderExtensionOptions {
  cwd?: string;
}

const EXTENSION_MANIFEST_RELATIVE_PATH = path.join(
  ".doc-vader",
  "extensions",
  "manifest.json",
);

function extensionManifestPath(cwd: string): string {
  return path.join(cwd, EXTENSION_MANIFEST_RELATIVE_PATH);
}

function emptyExtensionManifest(): DocVaderExtensionManifest {
  return {
    schemaVersion: "doc-vader/extensions/v1",
    extensions: [],
  };
}

function parseExtensionList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

async function readPackageExtensions(cwd: string): Promise<string[]> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(cwd, "package.json"), "utf8"),
    ) as PackageJsonWithDocVaderExtensions;
    return parseExtensionList(packageJson.docVader?.extensions);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseManifest(value: unknown): DocVaderExtensionManifest {
  if (!value || typeof value !== "object") {
    return emptyExtensionManifest();
  }
  const candidate = value as Partial<DocVaderExtensionManifest>;
  if (!Array.isArray(candidate.extensions)) {
    return emptyExtensionManifest();
  }
  return {
    schemaVersion: "doc-vader/extensions/v1",
    extensions: candidate.extensions
      .filter((entry): entry is InstalledDocVaderExtension => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const candidateEntry = entry as Partial<InstalledDocVaderExtension> & {
          specifier?: string;
        };
        return Boolean(
          typeof candidateEntry.name === "string" &&
            (typeof candidateEntry.packageSpecifier === "string" ||
              typeof candidateEntry.specifier === "string"),
        );
      })
      .map((entry) => {
        const legacyEntry = entry as InstalledDocVaderExtension & {
          specifier?: string;
        };
        const packageSpecifier = legacyEntry.packageSpecifier ?? legacyEntry.specifier ?? "";
        return {
          name: legacyEntry.name,
          packageName: legacyEntry.packageName ?? legacyEntry.name,
          packageSpecifier,
          entrypoint: legacyEntry.entrypoint ?? packageSpecifier,
          enabled: legacyEntry.enabled !== false,
          installedAt: legacyEntry.installedAt || new Date(0).toISOString(),
        };
      }),
  };
}

export async function readExtensionManifest(
  cwd = process.cwd(),
): Promise<DocVaderExtensionManifest> {
  try {
    return parseManifest(
      JSON.parse(await readFile(extensionManifestPath(cwd), "utf8")) as unknown,
    );
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;
    if (code === "ENOENT") {
      return emptyExtensionManifest();
    }
    throw error;
  }
}

async function writeExtensionManifest(
  manifest: DocVaderExtensionManifest,
  cwd: string,
): Promise<void> {
  const manifestPath = extensionManifestPath(cwd);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(`${manifestPath}.tmp`, manifestPath);
}

async function readManifestExtensions(cwd: string): Promise<InstalledDocVaderExtension[]> {
  const manifest = await readExtensionManifest(cwd);
  return manifest.extensions.filter((extension) => extension.enabled);
}

function readEnvironmentExtensions(): string[] {
  return (process.env.DV_EXTENSIONS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

interface ExtensionPackageJson {
  name?: string;
  main?: string;
  exports?: unknown;
  docVader?: {
    extension?: unknown;
  };
}

function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:");
}

function isScriptSpecifier(specifier: string): boolean {
  return /\.[cm]?js$/i.test(specifier) || /\.[cm]?ts$/i.test(specifier);
}

function rejectScriptSpecifier(specifier: string): void {
  if (isScriptSpecifier(specifier)) {
    throw new Error(
      `Doc-Vader extensions install expects a Node package name or package directory, not a script path: ${specifier}`,
    );
  }
}

function normalizePackageSpecifier(specifier: string, cwd: string): string {
  rejectScriptSpecifier(specifier);
  if (specifier.startsWith("file:")) {
    return specifier;
  }
  if (specifier.startsWith("/") || specifier.startsWith(".")) {
    const absolutePath = path.resolve(cwd, specifier);
    const relativePath = path.relative(cwd, absolutePath);
    return relativePath.startsWith("..") || path.isAbsolute(relativePath)
      ? absolutePath
      : `./${relativePath.split(path.sep).join("/")}`;
  }
  return specifier;
}

function resolvePackageDirectory(packageSpecifier: string, cwd: string): string | undefined {
  if (!isPathSpecifier(packageSpecifier)) {
    return undefined;
  }
  if (packageSpecifier.startsWith("file:")) {
    return new URL(packageSpecifier).pathname;
  }
  return path.resolve(cwd, packageSpecifier);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readExportString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readString(record.import) ?? readString(record.default);
  }
  return undefined;
}

function resolvePackageEntrypoint(
  packageSpecifier: string,
  packageJson: ExtensionPackageJson,
): string {
  const configuredEntrypoint = readString(packageJson.docVader?.extension);
  if (configuredEntrypoint) {
    return configuredEntrypoint;
  }
  if (packageJson.exports && typeof packageJson.exports === "object") {
    const exportsRecord = packageJson.exports as Record<string, unknown>;
    const rootExport = exportsRecord["."] ?? packageJson.exports;
    const exported = readExportString(rootExport);
    if (exported) {
      return exported;
    }
  }
  return packageJson.main ?? "index.js";
}

async function readExtensionPackage(
  packageSpecifier: string,
  cwd: string,
): Promise<{ packageJson: ExtensionPackageJson; packageRoot?: string }> {
  const packageRoot = resolvePackageDirectory(packageSpecifier, cwd);
  if (!packageRoot) {
    return {
      packageJson: {
        name: packageSpecifier,
        docVader: { extension: packageSpecifier },
      },
    };
  }
  const packageStat = await stat(packageRoot).catch(() => undefined);
  if (!packageStat?.isDirectory()) {
    throw new Error(
      `Doc-Vader extension package path must be a directory with package.json: ${packageSpecifier}`,
    );
  }
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as ExtensionPackageJson;
  return { packageJson, packageRoot };
}

async function resolveExtensionEntrypoint(
  extension: InstalledDocVaderExtension | string,
  cwd: string,
): Promise<string> {
  if (typeof extension === "string") {
    if (!isPathSpecifier(extension)) {
      return extension;
    }
    const { packageJson, packageRoot } = await readExtensionPackage(extension, cwd);
    if (!packageRoot) {
      return extension;
    }
    return pathToFileURL(
      path.resolve(packageRoot, resolvePackageEntrypoint(extension, packageJson)),
    ).href;
  }

  if (!isPathSpecifier(extension.packageSpecifier)) {
    return extension.entrypoint === extension.packageSpecifier
      ? extension.packageSpecifier
      : `${extension.packageSpecifier}/${extension.entrypoint.replace(/^\.\//, "")}`;
  }
  const packageRoot = resolvePackageDirectory(extension.packageSpecifier, cwd);
  if (!packageRoot) {
    return extension.entrypoint;
  }
  if (isScriptSpecifier(extension.packageSpecifier)) {
    return pathToFileURL(packageRoot).href;
  }
  return pathToFileURL(path.resolve(packageRoot, extension.entrypoint)).href;
}

export function getRegistrar(module: DocVaderExtensionModule):
  | ((program: Command, context: DocVaderExtensionContext) => void | Promise<void>)
  | undefined {
  if (typeof module.registerDocVaderExtension === "function") {
    return module.registerDocVaderExtension;
  }
  if (typeof module.register === "function") {
    return module.register;
  }
  if (typeof module.default === "function") {
    return module.default;
  }
  if (module.default && typeof module.default === "object") {
    return getRegistrar(module.default);
  }
  return undefined;
}

export async function getConfiguredExtensionSpecifiers(
  cwd = process.cwd(),
): Promise<Array<string | InstalledDocVaderExtension>> {
  return [
    ...readEnvironmentExtensions(),
    ...(await readManifestExtensions(cwd)),
    ...(await readPackageExtensions(cwd)),
  ];
}

export async function listInstalledExtensions(
  cwd = process.cwd(),
): Promise<InstalledDocVaderExtension[]> {
  return (await readExtensionManifest(cwd)).extensions;
}

export async function installDocVaderExtension(
  specifier: string,
  options: InstallDocVaderExtensionOptions = {},
): Promise<InstalledDocVaderExtension> {
  const cwd = options.cwd ?? process.cwd();
  const packageSpecifier = normalizePackageSpecifier(specifier, cwd);
  const { packageJson } = await readExtensionPackage(packageSpecifier, cwd);
  const entrypoint = resolvePackageEntrypoint(packageSpecifier, packageJson);
  const installedExtension: InstalledDocVaderExtension = {
    name: options.name ?? packageJson.name ?? packageSpecifier,
    packageName: packageJson.name ?? packageSpecifier,
    packageSpecifier,
    entrypoint,
    enabled: options.enabled ?? true,
    installedAt: new Date().toISOString(),
  };

  if (options.validate !== false) {
    const extensionModule = (await import(
      await resolveExtensionEntrypoint(installedExtension, cwd),
    )) as DocVaderExtensionModule;
    const register = getRegistrar(extensionModule);
    if (!register) {
      throw new Error(
        `Doc-Vader extension package ${specifier} does not export registerDocVaderExtension(program, context).`,
      );
    }
  }

  const manifest = await readExtensionManifest(cwd);
  const withoutExisting = manifest.extensions.filter(
    (extension) =>
      extension.name !== installedExtension.name &&
      extension.packageSpecifier !== installedExtension.packageSpecifier,
  );
  const nextManifest: DocVaderExtensionManifest = {
    schemaVersion: "doc-vader/extensions/v1",
    extensions: [...withoutExisting, installedExtension].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
  await writeExtensionManifest(nextManifest, cwd);
  return installedExtension;
}

export async function uninstallDocVaderExtension(
  nameOrSpecifier: string,
  options: UninstallDocVaderExtensionOptions = {},
): Promise<InstalledDocVaderExtension | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const manifest = await readExtensionManifest(cwd);
  const removed = manifest.extensions.find(
    (extension) =>
      extension.name === nameOrSpecifier ||
      extension.packageName === nameOrSpecifier ||
      extension.packageSpecifier === nameOrSpecifier,
  );
  if (!removed) {
    return undefined;
  }
  await writeExtensionManifest(
    {
      schemaVersion: "doc-vader/extensions/v1",
      extensions: manifest.extensions.filter((extension) => extension !== removed),
    },
    cwd,
  );
  return removed;
}

export async function registerConfiguredExtensions(
  program: Command,
  cwd = process.cwd(),
): Promise<void> {
  const context: DocVaderExtensionContext = { cwd };
  const registeredEntrypoints = new Set<string>();
  for (const specifier of await getConfiguredExtensionSpecifiers(cwd)) {
    const resolvedSpecifier = await resolveExtensionEntrypoint(specifier, cwd);
    if (registeredEntrypoints.has(resolvedSpecifier)) {
      continue;
    }
    registeredEntrypoints.add(resolvedSpecifier);
    const extensionModule = (await import(resolvedSpecifier)) as DocVaderExtensionModule;
    const register = getRegistrar(extensionModule);
    if (!register) {
      const extensionName = typeof specifier === "string" ? specifier : specifier.packageName;
      throw new Error(
        `Doc-Vader extension ${extensionName} does not export registerDocVaderExtension(program, context).`,
      );
    }
    await register(program, context);
  }
}
