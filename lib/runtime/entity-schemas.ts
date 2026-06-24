import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Type, type Static, type TSchema } from "@sinclair/typebox";

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const JSON_SCHEMA_2020_12_OPTIONS = { $schema: JSON_SCHEMA_2020_12 } as const;

export const RUNTIME_SCHEMA_VERSION = "runtime-entity/v1" as const;

const RUNTIME_EXECUTION_STATE_VALUES = [
  "running",
  "completed",
  "halted",
  "failed",
] as const;

const RUNTIME_EXECUTION_HALTED_REASONS = [
  "conflict",
  "blocked",
  "invalid",
  "expired",
  "revoked",
  "cancelled",
] as const;

const RUNTIME_EXECUTION_REASON_VALUES = [
  "started",
  "success",
  "error",
  ...RUNTIME_EXECUTION_HALTED_REASONS,
] as const;

const SOURCE_STYLE_DETAIL_CODE_PATTERN =
  "^(?:x-[a-z0-9]+(?:-[a-z0-9]+)*|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$";
const TARGET_TYPE_PATTERN = "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$";
const SHA256_HEX_PATTERN = "^[a-f0-9]{64}$";

function createLiteralSchemaTuple(
  values: readonly [string, ...string[]],
) {
  return values.map((value) => Type.Literal(value)) as unknown as [
    TSchema,
    ...TSchema[],
  ];
}

const ISO_TIMESTAMP_SCHEMA = Type.String({
  format: "date-time",
  description: "RFC 3339 timestamp emitted by the local runtime authority.",
});

const RuntimeMetadataSchema = Type.Record(Type.String(), Type.Unknown(), {
  description: "Opaque runtime metadata carried with claims and locks.",
});

const RuntimeTargetTypeSchema = Type.String({
  pattern: TARGET_TYPE_PATTERN,
  description:
    "Canonical runtime target type, such as 'task' or another governed artifact type.",
});

const RuntimeTargetIdSchema = Type.String({
  minLength: 1,
  description:
    "Canonical runtime target identifier for the selected target type.",
});

const RuntimeClaimTokenSchema = Type.String({
  minLength: 1,
  description: "Stable public ownership and correlation token for the claim.",
});

const RuntimeHolderSchema = Type.String({
  minLength: 1,
  description: "Authority-emitted holder identifier for the execution claim.",
});

const RuntimeLockPathSchema = Type.String({
  minLength: 1,
  pattern: "^(?!/)[^\\0]+$",
  description:
    "Normalized repo-relative artifact path used as the lock identity surface.",
});

export interface RuntimeLockPathNormalizationOptions {
  rootDir?: string;
  cwd?: string;
  gitIgnoreCase?: boolean;
  trackedPaths?: Iterable<string>;
}

export interface RuntimeChangedFileInput {
  status: string;
  path?: string;
  previousPath?: string;
}

export interface RuntimeRenameDiagnostic {
  code: "runtime-rename-detected" | "runtime-case-only-rename-detected";
  message: string;
  details: {
    status: string;
    path: string;
    previousPath?: string;
    caseOnly: boolean;
  };
}

export class RuntimeRenameDetectionError extends Error {
  readonly diagnostics: RuntimeRenameDiagnostic[];

  constructor(diagnostics: RuntimeRenameDiagnostic[]) {
    super("Git-detected renames are not supported in MVP.");
    this.name = "RuntimeRenameDetectionError";
    this.diagnostics = diagnostics;
  }
}

export const RuntimeDetailCodeSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: SOURCE_STYLE_DETAIL_CODE_PATTERN,
  description:
    "Bounded source-style code. Canonical values and x-* extensions are allowed.",
});

export const RuntimeExecutionStateSchema = Type.Union(
  createLiteralSchemaTuple(
    RUNTIME_EXECUTION_STATE_VALUES,
  ),
  {
    description: "Bounded execution state for runtime attempts.",
  },
);

export const RuntimeExecutionReasonSchema = Type.Union(
  createLiteralSchemaTuple(
    RUNTIME_EXECUTION_REASON_VALUES,
  ),
  {
    description:
      "Bounded execution reason values compatible with the execution state matrix.",
  },
);

export const RuntimeExecutionStateReasonMatrix = {
  running: ["started"],
  completed: ["success"],
  failed: ["error"],
  halted: RUNTIME_EXECUTION_HALTED_REASONS,
} as const;

export type RuntimeExecutionState =
  keyof typeof RuntimeExecutionStateReasonMatrix;

export type RuntimeExecutionReason =
  (typeof RuntimeExecutionStateReasonMatrix)[RuntimeExecutionState][number];

export const RuntimeDetailSchema = Type.Object(
  {
    code: RuntimeDetailCodeSchema,
    message: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Human-readable runtime summary for operators.",
      }),
    ),
  },
  {
    additionalProperties: false,
    patternProperties: {
      "^x-[a-z0-9]+(?:-[a-z0-9]+)*$": Type.Unknown(),
    },
    description:
      "Structured runtime detail payload with explicit x-* extension support.",
  },
);

export const RuntimeClaimSchema = Type.Object(
  {
    schema_version: Type.Literal(RUNTIME_SCHEMA_VERSION),
    claim_token: RuntimeClaimTokenSchema,
    target_type: RuntimeTargetTypeSchema,
    target_id: RuntimeTargetIdSchema,
    holder: RuntimeHolderSchema,
    created_at: ISO_TIMESTAMP_SCHEMA,
    expires_at: ISO_TIMESTAMP_SCHEMA,
    metadata: Type.Optional(RuntimeMetadataSchema),
  },
  {
    ...JSON_SCHEMA_2020_12_OPTIONS,
    additionalProperties: false,
    description: "Runtime claim lease/context record.",
  },
);

export const RuntimeLockSchema = Type.Object(
  {
    schema_version: Type.Literal(RUNTIME_SCHEMA_VERSION),
    key: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: SHA256_HEX_PATTERN,
      description: "Stable SHA-256 key derived from the normalized path.",
    }),
    path: RuntimeLockPathSchema,
    claim_token: RuntimeClaimTokenSchema,
    target_type: RuntimeTargetTypeSchema,
    target_id: RuntimeTargetIdSchema,
    created_at: ISO_TIMESTAMP_SCHEMA,
    metadata: Type.Optional(RuntimeMetadataSchema),
  },
  {
    ...JSON_SCHEMA_2020_12_OPTIONS,
    additionalProperties: false,
    description: "Runtime lock record for a single mutable artifact path.",
  },
);

function createRuntimeExecutionLogVariantSchema(
  state: RuntimeExecutionState,
  reason: RuntimeExecutionReason,
): ReturnType<typeof Type.Object> {
  return Type.Object(
    {
      schema_version: Type.Literal(RUNTIME_SCHEMA_VERSION),
      claim_token: RuntimeClaimTokenSchema,
      target_type: RuntimeTargetTypeSchema,
      target_id: RuntimeTargetIdSchema,
      created_at: ISO_TIMESTAMP_SCHEMA,
      detail: RuntimeDetailSchema,
      state: Type.Literal(state),
      reason: Type.Literal(reason),
    },
    {
      ...JSON_SCHEMA_2020_12_OPTIONS,
      additionalProperties: false,
      description: "Append-only runtime execution summary entry.",
    },
  );
}

const RuntimeExecutionRunningSchema = createRuntimeExecutionLogVariantSchema(
  "running",
  "started",
);

const RuntimeExecutionCompletedSchema = createRuntimeExecutionLogVariantSchema(
  "completed",
  "success",
);

const RuntimeExecutionFailedSchema = createRuntimeExecutionLogVariantSchema(
  "failed",
  "error",
);

const RuntimeExecutionHaltedSchema = Type.Union(
  RUNTIME_EXECUTION_HALTED_REASONS.map((reason) =>
    createRuntimeExecutionLogVariantSchema("halted", reason),
  ) as [
    ReturnType<typeof createRuntimeExecutionLogVariantSchema>,
    ...ReturnType<typeof createRuntimeExecutionLogVariantSchema>[],
  ],
  {
    description:
      "Halted execution entries with bounded reason compatibility.",
  },
);

export const RuntimeExecutionLogEntrySchema = Type.Union(
  [
    RuntimeExecutionRunningSchema,
    RuntimeExecutionCompletedSchema,
    RuntimeExecutionFailedSchema,
    RuntimeExecutionHaltedSchema,
  ],
  {
    ...JSON_SCHEMA_2020_12_OPTIONS,
    description:
      "Execution log entry constrained by the bounded runtime state/reason matrix.",
  },
);

export type RuntimeClaim = Static<typeof RuntimeClaimSchema>;
export type RuntimeLock = Static<typeof RuntimeLockSchema>;
export type RuntimeExecutionLogEntry = Static<
  typeof RuntimeExecutionLogEntrySchema
>;

function createRuntimeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

const runtimeAjv = createRuntimeAjv();

const validateRuntimeClaim = runtimeAjv.compile(RuntimeClaimSchema);
const validateRuntimeLock = runtimeAjv.compile(RuntimeLockSchema);
const validateRuntimeExecutionLogEntry = runtimeAjv.compile(
  RuntimeExecutionLogEntrySchema,
);

export function isRuntimeClaim(value: unknown): value is RuntimeClaim {
  return validateRuntimeClaim(value);
}

export function isRuntimeLock(value: unknown): value is RuntimeLock {
  return validateRuntimeLock(value);
}

export function isRuntimeExecutionLogEntry(
  value: unknown,
): value is RuntimeExecutionLogEntry {
  return validateRuntimeExecutionLogEntry(value);
}

export function assertRuntimeClaim(value: unknown): asserts value is RuntimeClaim {
  if (!isRuntimeClaim(value)) {
    throw new Error("Invalid runtime claim payload.");
  }
}

export function assertRuntimeLock(value: unknown): asserts value is RuntimeLock {
  if (!isRuntimeLock(value)) {
    throw new Error("Invalid runtime lock payload.");
  }
}

export function assertRuntimeExecutionLogEntry(
  value: unknown,
): asserts value is RuntimeExecutionLogEntry {
  if (!isRuntimeExecutionLogEntry(value)) {
    throw new Error("Invalid runtime execution log entry payload.");
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function normalizeOptions(
  rootDirOrOptions?: string | RuntimeLockPathNormalizationOptions,
): RuntimeLockPathNormalizationOptions {
  if (typeof rootDirOrOptions === "string") {
    return { rootDir: rootDirOrOptions };
  }
  return rootDirOrOptions ?? {};
}

function resolveRuntimeLockPathContext(
  options: RuntimeLockPathNormalizationOptions,
): { rootDir: string; cwd: string } {
  return {
    rootDir: path.resolve(options.rootDir ?? process.cwd()),
    cwd: path.resolve(options.cwd ?? options.rootDir ?? process.cwd()),
  };
}

function readGitCoreIgnoreCase(rootDir: string): boolean {
  try {
    const output = execFileSync(
      "git",
      ["-C", rootDir, "config", "--bool", "core.ignorecase"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return output === "true";
  } catch {
    return false;
  }
}

function readGitTrackedPaths(rootDir: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["-C", rootDir, "ls-files", "-z", "--full-name"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildTrackedPrefixMap(trackedPaths: Iterable<string>): Map<string, string> {
  const prefixMap = new Map<string, string>();
  for (const trackedPath of trackedPaths) {
    const normalized = trackedPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized) {
      continue;
    }
    const segments = normalized.split("/").filter(Boolean);
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const key = prefix.toLowerCase();
      if (!prefixMap.has(key)) {
        prefixMap.set(key, prefix);
      }
    }
  }
  return prefixMap;
}

function canonicalizeRuntimeLockPath(
  normalizedPath: string,
  options: RuntimeLockPathNormalizationOptions,
): string {
  const { rootDir } = resolveRuntimeLockPathContext(options);
  const gitIgnoreCase = options.gitIgnoreCase ?? readGitCoreIgnoreCase(rootDir);
  if (!gitIgnoreCase) {
    return normalizedPath;
  }

  const trackedPaths = options.trackedPaths ?? readGitTrackedPaths(rootDir);
  const prefixMap = buildTrackedPrefixMap(trackedPaths);
  if (prefixMap.size === 0) {
    return normalizedPath;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const canonicalSegments: string[] = [];
  let canonicalizedPrefix = "";
  let preserveRemainder = false;

  for (const segment of segments) {
    if (preserveRemainder) {
      canonicalSegments.push(segment);
      continue;
    }
    const candidatePrefix = canonicalizedPrefix
      ? `${canonicalizedPrefix}/${segment}`
      : segment;
    const canonicalPrefix = prefixMap.get(candidatePrefix.toLowerCase());
    if (!canonicalPrefix) {
      preserveRemainder = true;
      canonicalSegments.push(segment);
      canonicalizedPrefix = candidatePrefix;
      continue;
    }

    canonicalizedPrefix = canonicalPrefix;
    canonicalSegments.length = 0;
    canonicalSegments.push(...canonicalPrefix.split("/"));
  }

  return canonicalSegments.length > 0 ? canonicalSegments.join("/") : normalizedPath;
}

function isDirectoryPath(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeRuntimeLockPath(
  inputPath: string,
  rootDirOrOptions?: string | RuntimeLockPathNormalizationOptions,
): string {
  const options = normalizeOptions(rootDirOrOptions);
  const { rootDir, cwd } = resolveRuntimeLockPathContext(options);
  const resolvedPath = path.resolve(cwd, inputPath);
  const relativePath = path.relative(rootDir, resolvedPath);
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Lock path escapes the repository root: ${inputPath}`);
  }
  const normalizedPath = toPosixPath(path.normalize(relativePath));
  return canonicalizeRuntimeLockPath(normalizedPath, {
    ...options,
    rootDir,
    cwd,
  });
}

export function deriveRuntimeLockKey(normalizedPath: string): string {
  return createHash("sha256").update(normalizedPath, "utf8").digest("hex");
}

export function createRuntimeLockIdentity(
  inputPath: string,
  rootDirOrOptions?: string | RuntimeLockPathNormalizationOptions,
): { path: string; key: string } {
  const options = normalizeOptions(rootDirOrOptions);
  const { rootDir, cwd } = resolveRuntimeLockPathContext(options);
  const normalizedPath = normalizeRuntimeLockPath(inputPath, {
    ...options,
    rootDir,
  });
  const resolvedPath = path.resolve(cwd, inputPath);
  if (isDirectoryPath(resolvedPath)) {
    throw new Error(`Lock path targets a directory, not a file: ${inputPath}`);
  }
  return {
    path: normalizedPath,
    key: deriveRuntimeLockKey(normalizedPath),
  };
}

export function detectRuntimeRenameDiagnostics(
  changedFiles: Iterable<RuntimeChangedFileInput>,
): RuntimeRenameDiagnostic[] {
  const diagnostics: RuntimeRenameDiagnostic[] = [];
  for (const changedFile of changedFiles) {
    const status = changedFile.status.trim();
    const previousPath = changedFile.previousPath?.trim();
    const pathValue = changedFile.path?.trim();
    const renameDetected =
      (/^R\d*$/i.test(status) || /^C\d*$/i.test(status)) &&
      Boolean(previousPath && pathValue);
    if (!renameDetected || !pathValue) {
      continue;
    }
    const caseOnly =
      previousPath !== undefined &&
      previousPath.toLowerCase() === pathValue.toLowerCase() &&
      previousPath !== pathValue;
    diagnostics.push({
      code: caseOnly
        ? "runtime-case-only-rename-detected"
        : "runtime-rename-detected",
      message: caseOnly
        ? "Git case-only rename detected."
        : "Git rename detected.",
      details: {
        status,
        path: pathValue,
        ...(previousPath ? { previousPath } : {}),
        caseOnly,
      },
    });
  }
  return diagnostics;
}

export function assertRuntimeRenameDiagnostics(
  changedFiles: Iterable<RuntimeChangedFileInput>,
): void {
  const diagnostics = detectRuntimeRenameDiagnostics(changedFiles);
  if (diagnostics.length > 0) {
    throw new RuntimeRenameDetectionError(diagnostics);
  }
}
