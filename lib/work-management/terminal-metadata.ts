import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TerminalMetadataValidationResult {
  valid: boolean;
  missing: string[];
  schemaErrors: string[];
}

type JsonRecord = Record<string, unknown>;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export function findPackageRoot(startDir: string): string {
  let current = resolve(startDir);
  while (current !== dirname(current)) {
    if (
      existsSync(join(current, "package.json")) &&
      existsSync(join(current, "schemas"))
    ) {
      return current;
    }
    current = dirname(current);
  }
  return resolve(startDir, "..", "..");
}

const PACKAGE_ROOT = findPackageRoot(MODULE_DIR);
const STATUS_POLICY_ID = "/work-management/workflows/default/status-policy";
const TERMINAL_METADATA_SCHEMA_ID =
  "/work-management/workflows/default/terminal-metadata";
const VERSIONED_BASE_SCHEMA_ID =
  "https://raw.githubusercontent.com/calan-co/doc-vader/main/schemas/frontmatter/support/base/1.0.0";

let terminalMetadataValidator: ValidateFunction | undefined;

function readJson(pathFromRoot: string): JsonRecord {
  return JSON.parse(
    readFileSync(join(PACKAGE_ROOT, pathFromRoot), "utf8"),
  ) as JsonRecord;
}

function addSchemaWithJsonAlias(
  ajv: Ajv2020,
  schema: JsonRecord,
  aliases: readonly string[] = [],
): void {
  const schemaId = typeof schema.$id === "string" ? schema.$id : undefined;
  const ids = [
    schemaId,
    ...(schemaId && !schemaId.endsWith(".json") ? [`${schemaId}.json`] : []),
    ...aliases,
  ].filter((id): id is string => Boolean(id));
  for (const id of ids) {
    if (!ajv.getSchema(id)) {
      ajv.addSchema({ ...schema, $id: id });
    }
  }
}

function createTerminalMetadataValidator(): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  addSchemaWithJsonAlias(
    ajv,
    readJson("schemas/frontmatter/support/base/1.0.0.json"),
    [VERSIONED_BASE_SCHEMA_ID],
  );
  addSchemaWithJsonAlias(
    ajv,
    readJson("schemas/work-management/support/common.json"),
  );
  addSchemaWithJsonAlias(
    ajv,
    readJson("schemas/work-management/workflows/default/status-definitions.json"),
  );
  addSchemaWithJsonAlias(
    ajv,
    readJson(
      "schemas/work-management/workflows/default/generated/status-reason-compatibility.json",
    ),
  );
  addSchemaWithJsonAlias(
    ajv,
    readJson("schemas/work-management/workflows/default/status-policy.json"),
  );

  return ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: TERMINAL_METADATA_SCHEMA_ID,
    allOf: [
      { $ref: STATUS_POLICY_ID },
      {
        if: {
          type: "object",
          required: ["status"],
          properties: {
            status: { enum: ["completed", "aborted"] },
          },
        },
        then: {
          type: "object",
          required: ["links"],
          properties: {
            links: {
              type: "object",
              required: ["evidence"],
              properties: {
                evidence: {
                  $ref: "/work-management/support/common#/$defs/supportingRefList",
                },
              },
            },
          },
          allOf: [
            {
              if: {
                anyOf: [
                  { required: ["estimated"] },
                  {
                    not: {
                      required: ["tags"],
                      properties: {
                        tags: { type: "array", contains: { const: "afk" } },
                      },
                    },
                  },
                ],
              },
              then: { required: ["actual"] },
            },
          ],
        },
      },
    ],
  });
}

function getTerminalMetadataValidator(): ValidateFunction {
  terminalMetadataValidator ??= createTerminalMetadataValidator();
  return terminalMetadataValidator;
}

function describeError(error: ErrorObject): string {
  const path = error.instancePath || "/";
  if (error.keyword === "required") {
    const missingProperty = String(
      (error.params as { missingProperty?: unknown }).missingProperty ?? "field",
    );
    return `${path === "/" ? "" : path}/${missingProperty} is required`;
  }
  return `${path} ${error.message ?? "failed schema validation"}`;
}

function classifyMissing(error: ErrorObject): string | undefined {
  if (error.keyword !== "required") {
    return undefined;
  }

  const missingProperty = String(
    (error.params as { missingProperty?: unknown }).missingProperty ?? "",
  );
  if (missingProperty === "actual") {
    return "actual";
  }
  if (missingProperty === "links") {
    return "links.evidence";
  }
  if (error.instancePath === "/links" && missingProperty === "evidence") {
    return "links.evidence";
  }
  return undefined;
}

export function normalizeEvidenceLinks(frontmatter: JsonRecord): string[] {
  const links = frontmatter.links;
  if (typeof links !== "object" || links === null || Array.isArray(links)) {
    return [];
  }
  const evidence = (links as JsonRecord).evidence;
  if (!Array.isArray(evidence)) {
    return [];
  }
  return evidence.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

export function validateTerminalMetadata(
  frontmatter: JsonRecord,
): TerminalMetadataValidationResult {
  const validate = getTerminalMetadataValidator();
  const valid = validate(frontmatter);
  const errors = (validate.errors ?? []) as ErrorObject[];
  const missing = Array.from(
    new Set(errors.map(classifyMissing).filter((value): value is string => Boolean(value))),
  );
  const schemaErrors = errors.map(describeError);

  return {
    valid,
    missing,
    schemaErrors,
  };
}
