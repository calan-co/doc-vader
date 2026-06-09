#!/usr/bin/env tsx
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSchemaRegistry, readSchemaEnum } from './transition-profile.js';

type JsonRecord = Record<string, unknown>;

export interface StatusReasonCompatibilityGenerationOptions {
  generatedSchemaId: string;
  title: string;
  statusDimension: string;
  reasonDimension: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (current !== dirname(current)) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'schemas'))) {
      return current;
    }

    current = dirname(current);
  }

  return resolve(startDir, '..', '..');
}

const PACKAGE_ROOT = findPackageRoot(SCRIPT_DIR);
const DEFAULT_WORKFLOW_DIR = join(
  PACKAGE_ROOT,
  'schemas',
  'work-management',
  'workflows',
  'default'
);
const PROFILE_PATH = join(DEFAULT_WORKFLOW_DIR, 'transition-profile.json');
const STATUS_DEFINITIONS_SCHEMA_PATH = join(DEFAULT_WORKFLOW_DIR, 'status-definitions.schema.json');
const GENERATED_SCHEMA_PATH = join(
  DEFAULT_WORKFLOW_DIR,
  'generated',
  'status-reason-compatibility.schema.json'
);

function resolveGeneratedSchemaPath(): string {
  const override =
    process.env.DOC_VADER_GENERATED_SCHEMA_PATH ?? process.env.TEMPLJS_GENERATED_SCHEMA_PATH;
  return override ? resolve(process.cwd(), override) : GENERATED_SCHEMA_PATH;
}
const DEFAULT_OPTIONS: StatusReasonCompatibilityGenerationOptions = {
  generatedSchemaId:
    '/work-management/workflows/default/generated/status-reason-compatibility.schema.json',
  title: 'work-management/workflows/default/generated/status-reason-compatibility',
  statusDimension: 'status',
  reasonDimension: 'reason',
};

export class StatusReasonCompatibilityGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusReasonCompatibilityGenerationError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) {
    throw new StatusReasonCompatibilityGenerationError(`${path} must be an object`);
  }

  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StatusReasonCompatibilityGenerationError(`${path} must be a non-empty string`);
  }

  return value;
}

function readOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readString(value, path);
}

function readOptionalUniqueStringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new StatusReasonCompatibilityGenerationError(`${path} must be an array of strings`);
  }

  if (new Set(value).size !== value.length) {
    throw new StatusReasonCompatibilityGenerationError(`${path} must not contain duplicates`);
  }

  return value;
}

function readOptionalJsonPointerProperty(path: unknown, fieldPath: string): string | undefined {
  if (path === undefined) {
    return undefined;
  }

  const pointer = readString(path, fieldPath);
  if (!pointer.startsWith('/')) {
    throw new StatusReasonCompatibilityGenerationError(
      `${fieldPath} must be a JSON Pointer beginning with '/'`
    );
  }

  const segments = pointer
    .split('/')
    .slice(1)
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new StatusReasonCompatibilityGenerationError(
      `${fieldPath} must reference an object property`
    );
  }

  return segments.at(-1);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function wrapGenerationError(error: unknown): StatusReasonCompatibilityGenerationError {
  return error instanceof StatusReasonCompatibilityGenerationError
    ? error
    : new StatusReasonCompatibilityGenerationError((error as Error).message);
}

export function generateStatusReasonCompatibilitySchema(
  profileDocument: unknown,
  schemaDocuments: readonly JsonRecord[],
  options: StatusReasonCompatibilityGenerationOptions = DEFAULT_OPTIONS
): JsonRecord {
  try {
    const profile = readRecord(profileDocument, 'transition profile');
    const sourceDimensions = readRecord(profile.sourceDimensions, 'sourceDimensions');
    const statusDimension = readRecord(
      sourceDimensions[options.statusDimension],
      `sourceDimensions.${options.statusDimension}`
    );
    const reasonDimension = readRecord(
      sourceDimensions[options.reasonDimension],
      `sourceDimensions.${options.reasonDimension}`
    );
    const statusDomain = readString(
      statusDimension.domain,
      `sourceDimensions.${options.statusDimension}.domain`
    );
    const statusField = readOptionalJsonPointerProperty(
      statusDimension.path,
      `sourceDimensions.${options.statusDimension}.path`
    );
    const reasonField = readOptionalJsonPointerProperty(
      reasonDimension.path,
      `sourceDimensions.${options.reasonDimension}.path`
    );
    if (!statusField) {
      throw new StatusReasonCompatibilityGenerationError(
        `sourceDimensions.${options.statusDimension}.path is required`
      );
    }
    const domainBy = readRecord(
      reasonDimension.domainBy,
      `sourceDimensions.${options.reasonDimension}.domainBy`
    );
    const dependencyName = readString(
      domainBy.dimension,
      `sourceDimensions.${options.reasonDimension}.domainBy.dimension`
    );
    if (dependencyName !== options.statusDimension) {
      throw new StatusReasonCompatibilityGenerationError(
        `sourceDimensions.${options.reasonDimension}.domainBy.dimension must reference '${options.statusDimension}'`
      );
    }

    const registry = createSchemaRegistry(schemaDocuments, profile);
    const statuses = readSchemaEnum(registry, statusDomain);
    const cases = readRecord(
      domainBy.cases,
      `sourceDimensions.${options.reasonDimension}.domainBy.cases`
    );
    const requiredCases = readOptionalUniqueStringArray(
      domainBy.requiredCases,
      `sourceDimensions.${options.reasonDimension}.domainBy.requiredCases`
    );
    const extensionDomain = readOptionalString(
      domainBy.extensionDomain,
      `sourceDimensions.${options.reasonDimension}.domainBy.extensionDomain`
    );
    if (extensionDomain) {
      readSchemaEnum(registry, extensionDomain);
    }

    const statusSet = new Set(statuses);
    for (const caseName of Object.keys(cases)) {
      if (!statusSet.has(caseName)) {
        throw new StatusReasonCompatibilityGenerationError(
          `sourceDimensions.${options.reasonDimension}.domainBy.cases contains unknown ${options.statusDimension} case '${caseName}'`
        );
      }
    }

    for (const requiredCase of requiredCases) {
      if (!statusSet.has(requiredCase) || !hasOwn(cases, requiredCase)) {
        throw new StatusReasonCompatibilityGenerationError(
          `sourceDimensions.${options.reasonDimension}.domainBy.requiredCases contains unknown ${options.statusDimension} case '${requiredCase}'`
        );
      }
    }

    const branches = statuses.map((status) => {
      const casePath = `sourceDimensions.${options.reasonDimension}.domainBy.cases.${status}`;
      if (!hasOwn(cases, status)) {
        throw new StatusReasonCompatibilityGenerationError(`${casePath} is required`);
      }

      const reasonDomain = readString(cases[status], casePath);
      readSchemaEnum(registry, reasonDomain);

      const required = [statusField];
      if (reasonField && requiredCases.includes(status)) {
        required.push(reasonField);
      }

      const properties: Record<string, unknown> = {
        [statusField]: {
          const: status,
        },
      };

      if (reasonField) {
        properties[reasonField] = {
          anyOf: [
            {
              $ref: reasonDomain,
            },
            ...(extensionDomain ? [{ $ref: extensionDomain }] : []),
          ],
        };
      }

      return {
        type: 'object',
        required,
        properties,
      };
    });

    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: options.generatedSchemaId,
      title: options.title,
      description: 'Generated from the default work-item transition profile. Do not edit manually.',
      $comment:
        "GENERATED FILE. Run 'doc-vader work-management schemas generate' after editing ../transition-profile.json or ../status-definitions.schema.json.",
      oneOf: branches,
    };
  } catch (error) {
    throw wrapGenerationError(error);
  }
}

export function serializeGeneratedSchema(schema: JsonRecord): string {
  return `${serializeJson(schema)}\n`;
}

function serializeJson(value: unknown, depth = 0): string {
  const indentation = '  '.repeat(depth);
  const childIndentation = '  '.repeat(depth + 1);

  if (Array.isArray(value)) {
    const compact = `[${value.map((entry) => JSON.stringify(entry)).join(', ')}]`;
    const containsOnlyScalars = value.every(
      (entry) =>
        entry === null ||
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean'
    );
    if (containsOnlyScalars && indentation.length + compact.length <= 100) {
      return compact;
    }

    return `[\n${value
      .map((entry) => `${childIndentation}${serializeJson(entry, depth + 1)}`)
      .join(',\n')}\n${indentation}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    return `{\n${entries
      .map(
        ([key, entry]) =>
          `${childIndentation}${JSON.stringify(key)}: ${serializeJson(entry, depth + 1)}`
      )
      .join(',\n')}\n${indentation}}`;
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new StatusReasonCompatibilityGenerationError(
      'Generated schema contains an unsupported value'
    );
  }

  return serialized;
}

function readJsonFile(path: string): JsonRecord {
  try {
    return readRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown, path);
  } catch (error) {
    throw new StatusReasonCompatibilityGenerationError(
      `Unable to read JSON file '${relative(PACKAGE_ROOT, path)}': ${(error as Error).message}`
    );
  }
}

function writeGeneratedSchema(content: string): void {
  const generatedSchemaPath = resolveGeneratedSchemaPath();
  const outputDirectory = dirname(generatedSchemaPath);
  const temporaryPath = `${generatedSchemaPath}.${process.pid}.tmp`;

  mkdirSync(outputDirectory, { recursive: true });
  try {
    writeFileSync(temporaryPath, content, 'utf8');
    renameSync(temporaryPath, generatedSchemaPath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

function checkGeneratedSchema(content: string): void {
  const generatedSchemaPath = resolveGeneratedSchemaPath();

  if (!existsSync(generatedSchemaPath)) {
    throw new StatusReasonCompatibilityGenerationError(
      `Generated schema '${relative(PACKAGE_ROOT, generatedSchemaPath)}' is missing. Run 'doc-vader work-management schemas generate'.`
    );
  }

  if (readFileSync(generatedSchemaPath, 'utf8') !== content) {
    throw new StatusReasonCompatibilityGenerationError(
      `Generated schema '${relative(PACKAGE_ROOT, generatedSchemaPath)}' is stale. Run 'doc-vader work-management schemas generate'.`
    );
  }
}

export function main(args: readonly string[]): number {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    console.error(
      'Usage: doc-vader work-management schemas generate | doc-vader work-management schemas check'
    );
    return 1;
  }

  try {
    const profile = readJsonFile(PROFILE_PATH);
    const generated = serializeGeneratedSchema(
      generateStatusReasonCompatibilitySchema(profile, [
        profile,
        readJsonFile(STATUS_DEFINITIONS_SCHEMA_PATH),
      ])
    );

    if (args[0] === '--check') {
      checkGeneratedSchema(generated);
      console.log('Generated work-item status-reason compatibility schema is current.');
    } else {
      writeGeneratedSchema(generated);
      console.log(
        `Generated ${relative(PACKAGE_ROOT, GENERATED_SCHEMA_PATH)} from ${relative(PACKAGE_ROOT, PROFILE_PATH)}.`
      );
    }

    return 0;
  } catch (error) {
    console.error(
      `Failed to generate work-item status-reason compatibility schema: ${(error as Error).message}`
    );
    return 1;
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  process.exitCode = main(process.argv.slice(2));
}
