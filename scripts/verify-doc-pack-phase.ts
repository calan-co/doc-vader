import { access, readFile } from "node:fs/promises";

const phase = process.argv.at(2) === "--phase" ? process.argv.at(3) : undefined;

if (phase !== "1" && phase !== "2") {
  throw new Error("Usage: verify-doc-pack-phase.ts --phase <1|2>");
}

const phaseOneFiles = [
  "schemas/doc-vader/doc-pack.json",
  "docs/reference/document-type-packs.md",
  "docs/reference/doc-pack-inventory.md",
] as const;

async function requireFile(path: string): Promise<void> {
  await access(path);
}

type DeclarationSchema = {
  required?: unknown;
  oneOf?: unknown;
};

type ManifestSchema = {
  required?: unknown;
  $defs?: Record<string, DeclarationSchema>;
};

function hasRequiredFields(schema: DeclarationSchema | undefined, fields: readonly string[]): boolean {
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  return fields.every((field) => required.has(field));
}

async function verifyManifestContract(): Promise<void> {
  const schema = JSON.parse(
    await readFile("schemas/doc-vader/doc-pack.json", "utf8"),
  ) as ManifestSchema;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const expected = [
    "schemaVersion",
    "id",
    "namespace",
    "dependencies",
    "artifacts",
    "documentTypePacks",
    "extensions",
    "tests",
    "fixtures",
  ];

  if (!expected.every((field) => required.has(field))) {
    throw new Error("doc-pack manifest schema is missing a required contract field");
  }

  const definitions = schema.$defs;
  if (
    !hasRequiredFields(definitions?.artifactDeclaration, ["id", "kind", "ref"]) ||
    !hasRequiredFields(definitions?.documentTypePackDeclaration, ["id", "ref"])
  ) {
    throw new Error("doc-pack manifest schema is missing a required declaration field");
  }

  const extensionDeclarations = definitions?.extensionDeclaration?.oneOf;
  if (
    !Array.isArray(extensionDeclarations) ||
    !extensionDeclarations.some(
      (declaration) =>
        hasRequiredFields(declaration as DeclarationSchema, ["id", "kind", "ref"]),
    ) ||
    !extensionDeclarations.some(
      (declaration) =>
        hasRequiredFields(declaration as DeclarationSchema, ["id", "kind", "declaration"]),
    )
  ) {
    throw new Error("doc-pack manifest schema is missing an extension declaration contract");
  }
}

async function main(): Promise<void> {
  await Promise.all(phaseOneFiles.map(requireFile));
  await verifyManifestContract();

  if (phase === "2") {
    await requireFile("lib/doc-pack/index.ts");
  }

  console.log(JSON.stringify({ phase: Number(phase), valid: true }));
}

await main();
