import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export type DocPackManifest = Record<string, unknown>;

export interface DocPackDiagnostic {
  code: string;
}

export interface DocPackValidationReport {
  valid: boolean;
  diagnostics: readonly DocPackDiagnostic[];
}

type Declaration = Record<string, unknown>;

const schemaPath = [
  resolve(dirname(fileURLToPath(import.meta.url)), "../../schemas/doc-vader/doc-pack.json"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas/doc-vader/doc-pack.json"),
].find(existsSync);

if (!schemaPath) {
  throw new Error("Doc-pack schema is unavailable.");
}

const validateDocPackSchema = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(schemaPath, "utf8")),
);

function isDeclaration(value: unknown): value is Declaration {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasOpaqueRef(value: Declaration): boolean {
  return nonEmptyString(value.ref);
}

function immutableSnapshot<T>(value: T): T {
  const snapshot = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (!isDeclaration(candidate) && !Array.isArray(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };

  freeze(snapshot);
  return snapshot;
}

/**
 * Catalogs explicitly supplied doc-pack manifests. It deliberately neither
 * discovers manifests nor loads or executes their declared references.
 */
export class DocPackRegistry {
  private readonly packs = new Map<string, DocPackManifest>();

  validate(manifest: DocPackManifest): DocPackValidationReport {
    const diagnostics: DocPackDiagnostic[] = [];
    const add = (code: string): void => {
      diagnostics.push({ code });
    };

    if (!isDeclaration(manifest)) {
      add("invalid-schema");
      return { valid: false, diagnostics };
    }
    if (!validateDocPackSchema(manifest)) add("invalid-schema");

    const id = manifest.id;
    const namespace = manifest.namespace;

    if (!nonEmptyString(manifest.schemaVersion) || manifest.schemaVersion !== "doc-vader/doc-pack/v1") {
      add("invalid-schema-version");
    }
    if (!nonEmptyString(id) || id.includes(":")) {
      add("invalid-pack-id");
    }
    if (!nonEmptyString(namespace)) {
      add("invalid-pack-namespace");
    }

    this.validateDependencies(manifest.dependencies, id, add);
    this.validateArtifacts(manifest.artifacts, add);
    this.validateDocumentTypePacks(manifest.documentTypePacks, add);
    this.validateExtensions(manifest.extensions, add);
    this.validateLogicalReferenceIds(manifest, add);
    this.validateOpaqueReferenceList(manifest.tests, "invalid-test-declaration", add);
    this.validateOpaqueReferenceList(manifest.fixtures, "invalid-fixture-declaration", add);

    if (nonEmptyString(id) && this.packs.has(id)) {
      add("duplicate-pack-id");
    }
    if (
      nonEmptyString(namespace) &&
      Array.from(this.packs.values()).some((pack) => pack.namespace === namespace)
    ) {
      add("duplicate-pack-namespace");
    }

    return { valid: diagnostics.length === 0, diagnostics };
  }

  register(manifest: DocPackManifest): DocPackValidationReport {
    const report = this.validate(manifest);
    if (!report.valid) {
      return report;
    }

    this.packs.set(manifest.id as string, immutableSnapshot(manifest));
    return report;
  }

  get(id: string): DocPackManifest | undefined {
    const pack = this.packs.get(id);
    return pack && immutableSnapshot(pack);
  }

  list(): readonly DocPackManifest[] {
    return immutableSnapshot(Array.from(this.packs.values()));
  }

  resolve(logicalReference: string): unknown | undefined {
    const separator = logicalReference.indexOf(":");
    if (separator <= 0 || separator === logicalReference.length - 1) {
      return undefined;
    }

    const pack = this.packs.get(logicalReference.slice(0, separator));
    if (!pack) {
      return undefined;
    }

    const declarationId = logicalReference.slice(separator + 1);
    for (const declarations of [pack.artifacts, pack.documentTypePacks, pack.extensions]) {
      if (!Array.isArray(declarations)) continue;
      const declaration = declarations.find(
        (candidate): candidate is Declaration =>
          isDeclaration(candidate) &&
          candidate.id === declarationId &&
          hasOpaqueRef(candidate) &&
          (declarations !== pack.extensions || candidate.kind === "referenced"),
      );
      if (declaration) return immutableSnapshot(declaration.ref);
    }
    return undefined;
  }

  private validateDependencies(
    dependencies: unknown,
    packId: unknown,
    add: (code: string) => void,
  ): void {
    if (!Array.isArray(dependencies)) {
      add("invalid-dependency-declaration");
      return;
    }

    const seen = new Set<string>();
    for (const dependency of dependencies) {
      if (!nonEmptyString(dependency)) {
        add("invalid-dependency-declaration");
        continue;
      }
      if (seen.has(dependency)) {
        add("duplicate-dependency");
      }
      seen.add(dependency);
      if (dependency === packId || !this.packs.has(dependency)) {
        add("unresolved-dependency");
      }
    }
  }

  private validateArtifacts(
    artifacts: unknown,
    add: (code: string) => void,
  ): void {
    if (!Array.isArray(artifacts)) {
      add("invalid-artifact-declaration");
      return;
    }

    const seen = new Set<string>();
    for (const artifact of artifacts) {
      if (!isDeclaration(artifact) || !nonEmptyString(artifact.id) || !nonEmptyString(artifact.kind)) {
        add("invalid-artifact-declaration");
        continue;
      }
      if (seen.has(artifact.id)) {
        add("duplicate-artifact-id");
      }
      seen.add(artifact.id);
      if (!hasOpaqueRef(artifact)) {
        add("invalid-artifact-reference");
      }
    }
  }

  private validateDocumentTypePacks(
    documentTypePacks: unknown,
    add: (code: string) => void,
  ): void {
    if (!Array.isArray(documentTypePacks)) {
      add("invalid-document-type-pack-declaration");
      return;
    }

    const seen = new Set<string>();
    for (const pack of documentTypePacks) {
      if (!isDeclaration(pack) || !nonEmptyString(pack.id)) {
        add("invalid-document-type-pack-declaration");
        continue;
      }
      if (seen.has(pack.id)) {
        add("duplicate-document-type-pack-id");
      }
      seen.add(pack.id);
      if (!hasOpaqueRef(pack)) {
        add("invalid-document-type-pack-reference");
      }
    }
  }

  private validateExtensions(
    extensions: unknown,
    add: (code: string) => void,
  ): void {
    if (!Array.isArray(extensions)) {
      add("invalid-extension-declaration");
      return;
    }

    const seen = new Set<string>();
    for (const extension of extensions) {
      if (!isDeclaration(extension) || !nonEmptyString(extension.id)) {
        add("invalid-extension-declaration");
        continue;
      }
      if (seen.has(extension.id)) {
        add("duplicate-extension-id");
      }
      seen.add(extension.id);

      if (extension.kind === "referenced") {
        if (!hasOpaqueRef(extension)) {
          add("invalid-extension-reference");
        }
      } else if (extension.kind === "embedded") {
        if (!isDeclaration(extension.declaration)) {
          add("invalid-embedded-extension");
        }
      } else {
        add("invalid-extension-declaration");
      }
    }
  }

  private validateLogicalReferenceIds(
    manifest: DocPackManifest,
    add: (code: string) => void,
  ): void {
    const seen = new Set<string>();
    for (const declarations of [manifest.artifacts, manifest.documentTypePacks, manifest.extensions]) {
      if (!Array.isArray(declarations)) continue;
      for (const declaration of declarations) {
        if (!isDeclaration(declaration) || !nonEmptyString(declaration.id)) continue;
        if (declarations === manifest.extensions && declaration.kind !== "referenced") continue;
        if (seen.has(declaration.id)) add("duplicate-logical-reference-id");
        seen.add(declaration.id);
      }
    }
  }

  private validateOpaqueReferenceList(
    declarations: unknown,
    diagnostic: string,
    add: (code: string) => void,
  ): void {
    if (!Array.isArray(declarations) || declarations.some((declaration) => !nonEmptyString(declaration))) {
      add(diagnostic);
    }
  }
}
