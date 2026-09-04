import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import type { DocVaderConfig } from "../config/schema.js";
import type { MarkdownChecklistDefinition } from "../work-management/qualifiers.js";

export interface DocumentTypeDefinition {
  readonly type: string;
  readonly subtypes?: readonly string[];
  readonly metadataSchema: string;
  readonly contentSchema?: string;
  readonly handler?: string;
}

export interface DocumentTypePackManifest {
  readonly schemaVersion: "doc-vader/document-type-pack/v1";
  readonly name?: string;
  readonly namespace: string;
  readonly documentTypes: readonly DocumentTypeDefinition[];
  readonly checklistDefinitions?: readonly MarkdownChecklistDefinition[];
}

export interface SelectedDocumentTypePack {
  readonly manifest: DocumentTypePackManifest;
  readonly namespace: string;
  readonly documentType: DocumentTypeDefinition;
  readonly checklistDefinitions: readonly MarkdownChecklistDefinition[];
}

export interface DocumentTypePackSelection {
  readonly namespace: string;
  readonly type: string;
  readonly subtype?: string;
}

function validateManifest(manifest: DocumentTypePackManifest): void {
  if (manifest.schemaVersion !== "doc-vader/document-type-pack/v1") {
    throw new Error("Document type pack has an unsupported schemaVersion.");
  }
  if (!manifest.namespace || !Array.isArray(manifest.documentTypes) || manifest.documentTypes.length === 0) {
    throw new Error("Document type pack requires namespace and documentTypes.");
  }
  const manifestRoutes = new Set<string>();
  for (const documentType of manifest.documentTypes) {
    if (!documentType.type || !documentType.metadataSchema) {
      throw new Error("Document type pack documentTypes require type and metadataSchema.");
    }
    for (const route of [documentType.type, ...(documentType.subtypes ?? []).map((subtype: string) => `${documentType.type}:${subtype}`)]) {
      if (manifestRoutes.has(route)) throw new Error(`Duplicate document type pack route '${manifest.namespace}:${route}'.`);
      manifestRoutes.add(route);
    }
  }
  const checklistIds = new Set<string>();
  for (const definition of manifest.checklistDefinitions ?? []) {
    if (!definition.id || !definition.heading) {
      throw new Error("Checklist definitions require non-empty id and heading.");
    }
    if (checklistIds.has(definition.id)) {
      throw new Error(`Duplicate checklist definition id '${definition.id}'.`);
    }
    checklistIds.add(definition.id);
  }
}

/** A fail-closed registry of validated pack manifests and canonical routes. */
export class DocumentTypePackRegistry {
  private readonly packs = new Map<string, DocumentTypePackManifest>();
  private readonly routes = new Map<string, DocumentTypeDefinition>();

  register(manifest: DocumentTypePackManifest): void {
    validateManifest(manifest);
    if (this.packs.has(manifest.namespace)) {
      throw new Error(`Duplicate document type pack namespace '${manifest.namespace}'.`);
    }
    const routes: Array<[string, DocumentTypeDefinition]> = [];
    for (const documentType of manifest.documentTypes) {
      const typeKey = `${manifest.namespace}:${documentType.type}`;
      routes.push([typeKey, documentType]);
      for (const subtype of documentType.subtypes ?? []) {
        routes.push([`${typeKey}:${subtype}`, documentType]);
      }
    }
    for (const [key] of routes) {
      if (this.routes.has(key)) throw new Error(`Duplicate document type pack route '${key}'.`);
    }
    this.packs.set(manifest.namespace, Object.freeze({ ...manifest }));
    for (const [key, documentType] of routes) this.routes.set(key, documentType);
  }

  select(selection: DocumentTypePackSelection): SelectedDocumentTypePack {
    const manifest = this.packs.get(selection.namespace);
    const exact = selection.subtype
      ? this.routes.get(`${selection.namespace}:${selection.type}:${selection.subtype}`)
      : undefined;
    const documentType = exact ?? this.routes.get(`${selection.namespace}:${selection.type}`);
    if (!manifest || !documentType) {
      throw new Error(`No document type pack route for '${selection.namespace}:${selection.type}${selection.subtype ? `:${selection.subtype}` : ""}'.`);
    }
    return {
      manifest,
      namespace: manifest.namespace,
      documentType,
      checklistDefinitions: manifest.checklistDefinitions ?? [],
    };
  }
}

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function parseAndValidateManifest(raw: unknown): Promise<DocumentTypePackManifest> {
  const [packSchema, configSchema] = await Promise.all([
    readFile(resolve(repositoryRoot, "schemas/doc-vader/document-type-pack.json"), "utf8"),
    readFile(resolve(repositoryRoot, "schemas/doc-vader/config.json"), "utf8"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(JSON.parse(configSchema), "/doc-vader/config");
  const validate = ajv.compile(JSON.parse(packSchema));
  if (!validate(raw)) {
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`Document type pack manifest failed schema validation: ${errors}`);
  }
  return raw as DocumentTypePackManifest;
}

function resolveManifestSpecifier(specifier: string, baseDir: string): string {
  if (isAbsolute(specifier)) return specifier;
  if (specifier.startsWith(".")) return resolve(baseDir, specifier);
  try { return require.resolve(specifier, { paths: [baseDir] }); }
  catch { return resolve(baseDir, specifier); }
}

/** Load the explicitly configured external manifests. Arrays replace through config extends. */
export async function loadDocumentTypePackRegistry(options: {
  readonly config: Pick<DocVaderConfig, "documentTypePacks">;
  readonly baseDir: string;
  readonly builtIns?: readonly DocumentTypePackManifest[];
}): Promise<DocumentTypePackRegistry> {
  const registry = new DocumentTypePackRegistry();
  for (const manifest of options.builtIns ?? []) registry.register(manifest);
  for (const specifier of options.config.documentTypePacks ?? []) {
    const path = resolveManifestSpecifier(specifier, options.baseDir);
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { throw new Error(`Cannot load document type pack '${specifier}': ${error instanceof Error ? error.message : String(error)}`); }
    registry.register(await parseAndValidateManifest(parsed));
  }
  return registry;
}
