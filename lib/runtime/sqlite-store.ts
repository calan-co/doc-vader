import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  createRuntimeLockIdentity,
  detectRuntimeRenameDiagnostics,
  deriveRuntimeLockKey,
  assertRuntimeRenameDiagnostics,
  normalizeRuntimeLockPath,
  RuntimeRenameDetectionError,
  type RuntimeRenameDiagnostic,
} from "./entity-schemas.js";
import {
  evaluateRuntimeScopeLockPolicy,
  canonicalizeClaimScopeRef,
  type RuntimeScopeLock,
  type RuntimeScopeLockConflict,
  type RuntimeScopeLockLifecycleState,
  type RuntimeScopeLockMode,
  type RuntimeScopeLockPolicyName,
} from "./scope-locks.js";
export {
  createRuntimeLockIdentity,
  detectRuntimeRenameDiagnostics,
  deriveRuntimeLockKey,
  assertRuntimeRenameDiagnostics,
  normalizeRuntimeLockPath,
  RuntimeRenameDetectionError,
} from "./entity-schemas.js";

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
const DEFAULT_RUNTIME_DIR = ".doc-vader/runtime";
const DEFAULT_RUNTIME_DATABASE_NAME = "runtime.sqlite";
const RUNTIME_SQLITE_BUSY_TIMEOUT_MS = 5_000;
const RUNTIME_MIGRATION_ID = "0001-initial-runtime-entities";
const RUNTIME_MIGRATION_ID_LAST_SEEN = "0002-claim-last-seen";
const RUNTIME_MIGRATION_ID_SCOPE_LOCKS = "0003-claim-scope-locks";
const RUNTIME_INTERNAL_PATH_PREFIX = ".doc-vader/runtime/";
const DEFAULT_RUNTIME_CLAIM_TTL_MINUTES = 240;
const DEFAULT_RUNTIME_CLAIM_GRACE_SECONDS = 300;

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

export const RuntimeDetailCodeSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: SOURCE_STYLE_DETAIL_CODE_PATTERN,
  description:
    "Bounded source-style code. Canonical values and x-* extensions are allowed.",
});

export const RuntimeExecutionStateSchema = Type.Union(
  createLiteralSchemaTuple(RUNTIME_EXECUTION_STATE_VALUES),
  {
    description: "Bounded execution state for runtime attempts.",
  },
);

export const RuntimeExecutionReasonSchema = Type.Union(
  createLiteralSchemaTuple(RUNTIME_EXECUTION_REASON_VALUES),
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

export type RuntimeExecutionHaltedReason =
  (typeof RUNTIME_EXECUTION_HALTED_REASONS)[number];

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
    last_seen_at: Type.Optional(ISO_TIMESTAMP_SCHEMA),
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

const RUNTIME_SCOPE_LOCK_MODE_VALUES = [
  "read",
  "write",
  "execute",
] as const;

const RUNTIME_SCOPE_LOCK_LIFECYCLE_VALUES = [
  "active",
  "released",
] as const;

const RUNTIME_SCOPE_LOCK_POLICY_VALUES = [
  "ReadLockPolicy",
  "WriteLockPolicy",
  "ExecuteLockPolicy",
] as const;

export const RuntimeScopeLockSchema = Type.Object(
  {
    schema_version: Type.Literal(RUNTIME_SCHEMA_VERSION),
    claim_token: RuntimeClaimTokenSchema,
    scope_ref: Type.String({
      minLength: 1,
      description:
        "Canonical claim scope reference with storage-neutral identity.",
    }),
    lock_mode: Type.Union(
      createLiteralSchemaTuple(RUNTIME_SCOPE_LOCK_MODE_VALUES),
      {
        description: "Claim scope lock mode.",
      },
    ),
    policy_name: Type.Union(
      createLiteralSchemaTuple(RUNTIME_SCOPE_LOCK_POLICY_VALUES),
      {
        description: "Policy unit used to evaluate claim-scope compatibility.",
      },
    ),
    acquired_at: ISO_TIMESTAMP_SCHEMA,
    updated_at: ISO_TIMESTAMP_SCHEMA,
    lifecycle_state: Type.Union(
      createLiteralSchemaTuple(RUNTIME_SCOPE_LOCK_LIFECYCLE_VALUES),
      {
        description: "Lifecycle state for the claim-scope lock row.",
      },
    ),
    released_at: Type.Optional(ISO_TIMESTAMP_SCHEMA),
    metadata: Type.Optional(RuntimeMetadataSchema),
  },
  {
    ...JSON_SCHEMA_2020_12_OPTIONS,
    additionalProperties: false,
    description:
      "Runtime claim-scope lock record keyed by immutable claim identity, ScopeRef, and mode.",
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
const validateRuntimeScopeLock = runtimeAjv.compile(RuntimeScopeLockSchema);
const validateRuntimeExecutionLogEntry = runtimeAjv.compile(
  RuntimeExecutionLogEntrySchema,
);

export function isRuntimeClaim(value: unknown): value is RuntimeClaim {
  return validateRuntimeClaim(value);
}

export function isRuntimeLock(value: unknown): value is RuntimeLock {
  return validateRuntimeLock(value);
}

export function isRuntimeScopeLock(value: unknown): value is RuntimeScopeLock {
  return validateRuntimeScopeLock(value);
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

export function assertRuntimeScopeLock(
  value: unknown,
): asserts value is RuntimeScopeLock {
  if (!isRuntimeScopeLock(value)) {
    throw new Error("Invalid runtime scope lock payload.");
  }
}

export function assertRuntimeExecutionLogEntry(
  value: unknown,
): asserts value is RuntimeExecutionLogEntry {
  if (!isRuntimeExecutionLogEntry(value)) {
    throw new Error("Invalid runtime execution log entry payload.");
  }
}

export type RuntimeEntityKind =
  | "claim"
  | "lock"
  | "scope_lock"
  | "execution_log_entry";

export type RuntimeDurableWrite = (
  serializedPayload: string,
) => void | Promise<void>;

type RuntimeEntityMap = {
  claim: RuntimeClaim;
  lock: RuntimeLock;
  scope_lock: RuntimeScopeLock;
  execution_log_entry: RuntimeExecutionLogEntry;
};

function assertRuntimeEntity<K extends RuntimeEntityKind>(
  kind: K,
  value: unknown,
): asserts value is RuntimeEntityMap[K] {
  switch (kind) {
    case "claim":
      assertRuntimeClaim(value);
      return;
    case "lock":
      assertRuntimeLock(value);
      return;
    case "scope_lock":
      assertRuntimeScopeLock(value);
      return;
    case "execution_log_entry":
      assertRuntimeExecutionLogEntry(value);
      return;
    default:
      throw new Error(`Unsupported runtime entity kind: ${kind}`);
  }
}

export function serializeRuntimeEntityForWrite(
  kind: RuntimeEntityKind,
  value: unknown,
): string {
  assertRuntimeEntity(kind, value);
  return JSON.stringify(value);
}

export async function persistRuntimeEntityForWrite(
  kind: RuntimeEntityKind,
  value: unknown,
  write: RuntimeDurableWrite,
): Promise<void> {
  await write(serializeRuntimeEntityForWrite(kind, value));
}

export async function persistRuntimeClaimForWrite(
  value: unknown,
  write: RuntimeDurableWrite,
): Promise<void> {
  await persistRuntimeEntityForWrite("claim", value, write);
}

export async function persistRuntimeLockForWrite(
  value: unknown,
  write: RuntimeDurableWrite,
): Promise<void> {
  await persistRuntimeEntityForWrite("lock", value, write);
}

export async function persistRuntimeScopeLockForWrite(
  value: unknown,
  write: RuntimeDurableWrite,
): Promise<void> {
  await persistRuntimeEntityForWrite("scope_lock", value, write);
}

export async function persistRuntimeExecutionLogEntryForWrite(
  value: unknown,
  write: RuntimeDurableWrite,
): Promise<void> {
  await persistRuntimeEntityForWrite("execution_log_entry", value, write);
}

export interface RuntimeSqliteStoreOptions {
  rootDir?: string;
  runtimeDir?: string;
  databasePath?: string;
}

export interface RuntimeClaimRecord extends RuntimeClaim {
  state: "active" | "expired";
  last_seen_at?: string;
}

export interface RuntimeLockRecord extends RuntimeLock {}

export interface RuntimeScopeLockRecord extends RuntimeScopeLock {}

export interface RuntimeScopeLockConflictRecord
  extends RuntimeScopeLockConflict {
  owner?: {
    claim_token: string;
    target_type: string;
    target_id: string;
    state?: RuntimeClaimRecord["state"];
    expires_at?: string;
  };
}

export interface RuntimeScopeLockAcquisitionRequest {
  scopeRef: string;
  lockMode: RuntimeScopeLockMode;
  policyName?: RuntimeScopeLockPolicyName;
  metadata?: Record<string, unknown>;
}

export interface RuntimeScopeLockAcquisitionSuccess {
  outcome: "acquired";
  claimToken: string;
  locks: RuntimeScopeLockRecord[];
}

export interface RuntimeScopeLockAcquisitionConflict {
  outcome: "conflict";
  claimToken: string;
  conflicts: RuntimeScopeLockConflictRecord[];
}

export type RuntimeScopeLockAcquisitionResult =
  | RuntimeScopeLockAcquisitionSuccess
  | RuntimeScopeLockAcquisitionConflict;

export interface RuntimeClaimRenewalSuccess {
  outcome: "renewed";
  claimToken: string;
  claim: RuntimeClaimRecord;
}

export interface RuntimeClaimRenewalConflict {
  outcome: "conflict";
  claimToken: string;
  conflicts: RuntimeScopeLockConflictRecord[];
}

export type RuntimeClaimRenewalResult =
  | RuntimeClaimRenewalSuccess
  | RuntimeClaimRenewalConflict;

type RuntimeScopeLockDescriptor = {
  scopeRef: string;
  lockMode: RuntimeScopeLockMode;
  policyName: RuntimeScopeLockPolicyName;
};

type RuntimeNormalizedScopeLockRequest = RuntimeScopeLockDescriptor & {
  metadata?: Record<string, unknown>;
};

type RuntimeClaimTouchOptions = {
  now?: Date;
  renew?: boolean;
  ttlMilliseconds?: number;
};

type RuntimeClaimRenewalOptions = Omit<RuntimeClaimTouchOptions, "renew">;

export interface RuntimeExecutionLogRecord {
  id: number;
  schema_version: typeof RUNTIME_SCHEMA_VERSION;
  claim_token: string;
  target_type: string;
  target_id: string;
  state: RuntimeExecutionState;
  reason: RuntimeExecutionReason;
  created_at: string;
  payload: string;
}

export interface RuntimeClaimAcquisitionSeed {
  schema_version?: typeof RUNTIME_SCHEMA_VERSION;
  target_type: string;
  target_id: string;
  holder: string;
  created_at: string;
  expires_at: string;
  metadata?: Record<string, unknown>;
  entropy?: string;
}

export interface RuntimeLockConflictDetail {
  path: string;
  key: string;
  owner: {
    claim_token: string;
    target_type: string;
    target_id: string;
    state?: RuntimeClaimRecord["state"];
    expires_at?: string;
  };
}

export interface RuntimeInitialClaimAcquisitionSuccess {
  outcome: "acquired";
  claimToken: string;
  claim: RuntimeClaimRecord;
  scopeLock: RuntimeScopeLockRecord;
  locks: RuntimeLockRecord[];
  executionLogEntry: RuntimeExecutionLogRecord;
}

export interface RuntimeInitialClaimAcquisitionConflict {
  outcome: "conflict";
  claimToken: string;
  claim: RuntimeClaim;
  conflicts: RuntimeLockConflictDetail[];
  executionLogEntry: RuntimeExecutionLogRecord;
}

export type RuntimeInitialClaimAcquisitionResult =
  | RuntimeInitialClaimAcquisitionSuccess
  | RuntimeInitialClaimAcquisitionConflict;

export interface RuntimeLockAcquisitionSuccess {
  outcome: "acquired";
  claimToken: string;
  locks: RuntimeLockRecord[];
}

export interface RuntimeLockAcquisitionConflict {
  outcome: "conflict";
  claimToken: string;
  conflicts: RuntimeLockConflictDetail[];
}

export type RuntimeLockAcquisitionResult =
  | RuntimeLockAcquisitionSuccess
  | RuntimeLockAcquisitionConflict;

export interface RuntimeExecutionHaltDetail {
  code: string;
  message?: string;
  [key: `x-${string}`]: unknown;
}

export interface RuntimeExecutionHaltOptions {
  reason: RuntimeExecutionHaltedReason;
  detail: RuntimeExecutionHaltDetail;
}

export interface RuntimeExecutionHaltResult {
  claimToken: string;
  claim: RuntimeClaimRecord;
  locksRemoved: number;
  executionLogEntry: RuntimeExecutionLogRecord;
}

export interface RuntimeExecutionTerminalResult {
  claimToken: string;
  claim: RuntimeClaimRecord;
  locksRemoved: number;
  executionLogEntry: RuntimeExecutionLogRecord;
}

export type RuntimeLockWorktreeState = "clean" | "modified";

export interface RuntimeLockStatusRecord extends RuntimeLockRecord {
  state: RuntimeLockWorktreeState;
}

export interface RuntimeLockStatusResult {
  claimToken: string;
  claim?: RuntimeClaimRecord;
  state: RuntimeClaimRecord["state"] | "missing";
  locks: RuntimeLockStatusRecord[];
}

export interface RuntimeChangedFileAuditEntry {
  status: string;
  path: string;
  key: string;
  previousPath?: string;
}

export type RuntimeChangedFileAuditLockState =
  | "owned"
  | "missing"
  | "foreign-owned"
  | "expired"
  | "rename-detected";

export interface RuntimeChangedFileAuditDiagnostic {
  path: string;
  previousPath?: string;
  expectedClaimToken: string;
  actualLockState: RuntimeChangedFileAuditLockState;
  recommendedNextCommand: string;
  owner?: RuntimeLockConflictDetail["owner"];
  message: string;
}

export interface RuntimeChangedFileAuditResult {
  claimToken: string;
  claim?: RuntimeClaimRecord;
  mergeTargetRef: string;
  headRef?: string;
  headSha?: string;
  fresh: boolean;
  mergeable: boolean;
  changedFiles: RuntimeChangedFileAuditEntry[];
  changedPaths: string[];
  renameDiagnostics: RuntimeRenameDiagnostic[];
  diagnostics: RuntimeChangedFileAuditDiagnostic[];
  passed: boolean;
}

export interface RuntimeLockRemovalConflictDetail {
  path: string;
  key: string;
  reason: "invalid-target" | "missing" | "foreign-owned" | "modified";
  state?: RuntimeLockWorktreeState;
  owner?: RuntimeLockConflictDetail["owner"];
  message: string;
}

export interface RuntimeLockRemovalSuccess {
  outcome: "removed";
  claimToken: string;
  removed: RuntimeLockRecord[];
}

export interface RuntimeLockRemovalConflict {
  outcome: "conflict";
  claimToken: string;
  conflicts: RuntimeLockRemovalConflictDetail[];
}

export type RuntimeLockRemovalResult =
  | RuntimeLockRemovalSuccess
  | RuntimeLockRemovalConflict;

export interface RuntimeClaimCleanupConflictDetail {
  claim_token: string;
  target_type?: string;
  target_id?: string;
  reason: "active" | "running" | "missing" | "inconsistent";
  state?: RuntimeClaimRecord["state"];
  expires_at?: string;
  latest_execution_state?: RuntimeExecutionState;
  latest_execution_reason?: RuntimeExecutionReason;
  message: string;
}

export interface RuntimeClaimCleanupRemovalRecord {
  claimToken: string;
  claim: RuntimeClaimRecord;
  locksRemoved: number;
}

interface RuntimeClaimCleanupSuccess {
  outcome: "removed";
  removed: RuntimeClaimCleanupRemovalRecord[];
}

interface RuntimeClaimCleanupConflict {
  outcome: "conflict";
  conflicts: RuntimeClaimCleanupConflictDetail[];
}

export type RuntimeClaimCleanupResult =
  | RuntimeClaimCleanupSuccess
  | RuntimeClaimCleanupConflict;

type RuntimeExecutionLogInsert = {
  schema_version: typeof RUNTIME_SCHEMA_VERSION;
  claim_token: string;
  target_type: string;
  target_id: string;
  state: RuntimeExecutionState;
  reason: RuntimeExecutionReason;
  created_at: string;
};

const RUNTIME_SCHEMA_MIGRATIONS = [
  {
    id: RUNTIME_MIGRATION_ID,
    apply(database: DatabaseSync): void {
      database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS claims (
          schema_version TEXT NOT NULL,
          claim_token TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          holder TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT,
          UNIQUE(target_type, target_id)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS locks (
          schema_version TEXT NOT NULL,
          key TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          claim_token TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata TEXT,
          FOREIGN KEY (claim_token) REFERENCES claims(claim_token) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS execution_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schema_version TEXT NOT NULL,
          claim_token TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          state TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          payload TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_execution_log_claim_token
          ON execution_log(claim_token);
        CREATE INDEX IF NOT EXISTS idx_execution_log_target
          ON execution_log(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_execution_log_state_reason
          ON execution_log(state, reason);
        CREATE INDEX IF NOT EXISTS idx_execution_log_created_at
          ON execution_log(created_at);

        CREATE VIEW IF NOT EXISTS runtime_claims AS
          SELECT
            schema_version,
            claim_token,
            target_type,
            target_id,
            holder,
            expires_at,
            created_at,
            updated_at,
            created_at AS last_seen_at,
            metadata,
            CASE
              WHEN expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                THEN 'expired'
              ELSE 'active'
            END AS state
          FROM claims;
      `);
    },
  },
  {
    id: RUNTIME_MIGRATION_ID_LAST_SEEN,
    apply(database: DatabaseSync): void {
      database.exec(`
        ALTER TABLE claims ADD COLUMN last_seen_at TEXT;
        UPDATE claims SET last_seen_at = created_at WHERE last_seen_at IS NULL;
        DROP VIEW IF EXISTS runtime_claims;
        CREATE VIEW runtime_claims AS
          SELECT
            schema_version,
            claim_token,
            target_type,
            target_id,
            holder,
            expires_at,
            created_at,
            updated_at,
            last_seen_at,
            metadata,
            CASE
              WHEN expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                THEN 'expired'
              ELSE 'active'
            END AS state
          FROM claims;
      `);
    },
  },
  {
    id: RUNTIME_MIGRATION_ID_SCOPE_LOCKS,
    apply(database: DatabaseSync): void {
      database.exec(`
        CREATE TABLE IF NOT EXISTS claim_scope_locks (
          schema_version TEXT NOT NULL,
          claim_token TEXT NOT NULL,
          scope_ref TEXT NOT NULL,
          lock_mode TEXT NOT NULL,
          policy_name TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          released_at TEXT,
          metadata TEXT,
          PRIMARY KEY (claim_token, scope_ref, lock_mode),
          FOREIGN KEY (claim_token) REFERENCES claims(claim_token) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_claim_scope_locks_scope
          ON claim_scope_locks(scope_ref, lifecycle_state, lock_mode);
        CREATE INDEX IF NOT EXISTS idx_claim_scope_locks_claim_token
          ON claim_scope_locks(claim_token, lifecycle_state, acquired_at);
      `);
    },
  },
] as const;

function resolveRuntimeDatabasePath(
  rootDir: string,
  options: RuntimeSqliteStoreOptions,
): string {
  if (options.databasePath?.trim()) {
    return path.isAbsolute(options.databasePath)
      ? options.databasePath
      : path.resolve(rootDir, options.databasePath);
  }
  const runtimeDir = options.runtimeDir?.trim() ?? DEFAULT_RUNTIME_DIR;
  return path.resolve(rootDir, runtimeDir, DEFAULT_RUNTIME_DATABASE_NAME);
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = canonicalizeJsonValue(record[key]);
        return accumulator;
      }, {});
  }
  return value;
}

function stringifyCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

export function createRuntimeClaimToken(
  seed: Omit<RuntimeClaim, "claim_token"> & { entropy: string },
): string {
  return createHash("sha256")
    .update(stringifyCanonicalJson(seed), "utf8")
    .digest("hex");
}

function parseJsonColumn<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Expected runtime JSON column to be a string.");
  }
  return JSON.parse(value) as T;
}

function runTransaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original failure when rollback is a no-op or already unwound.
    }
    throw error;
  }
}

function initializeRuntimeSchema(database: DatabaseSync): void {
  runTransaction(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS runtime_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) WITHOUT ROWID;
    `);

    for (const migration of RUNTIME_SCHEMA_MIGRATIONS) {
      const applied = database.prepare(
        "SELECT 1 FROM runtime_migrations WHERE id = ?",
      ).get(migration.id);
      if (applied) {
        continue;
      }
      migration.apply(database);
      database.prepare(
        "INSERT INTO runtime_migrations (id, applied_at) VALUES (?, ?)",
      ).run(migration.id, new Date().toISOString());
    }
  });
}

function toRuntimeClaimRecord(row: Record<string, unknown>): RuntimeClaimRecord {
  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata);
  return {
    schema_version: row.schema_version as typeof RUNTIME_SCHEMA_VERSION,
    claim_token: row.claim_token as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    holder: row.holder as string,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    ...(typeof row.last_seen_at === "string"
      ? { last_seen_at: row.last_seen_at as string }
      : {}),
    ...(metadata ? { metadata } : {}),
    state: row.state === "expired" ? "expired" : "active",
  };
}

function toRuntimeLockRecord(row: Record<string, unknown>): RuntimeLockRecord {
  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata);
  return {
    schema_version: row.schema_version as typeof RUNTIME_SCHEMA_VERSION,
    key: row.key as string,
    path: row.path as string,
    claim_token: row.claim_token as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    created_at: row.created_at as string,
    ...(metadata ? { metadata } : {}),
  };
}

function toRuntimeScopeLockRecord(
  row: Record<string, unknown>,
): RuntimeScopeLockRecord {
  const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata);
  return {
    schema_version: row.schema_version as typeof RUNTIME_SCHEMA_VERSION,
    claim_token: row.claim_token as string,
    scope_ref: row.scope_ref as string,
    lock_mode: row.lock_mode as RuntimeScopeLockMode,
    policy_name: row.policy_name as RuntimeScopeLockPolicyName,
    acquired_at: row.acquired_at as string,
    updated_at: row.updated_at as string,
    lifecycle_state: row.lifecycle_state as RuntimeScopeLockLifecycleState,
    ...(typeof row.released_at === "string"
      ? { released_at: row.released_at as string }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function toRuntimeExecutionLogRecord(
  row: Record<string, unknown>,
): RuntimeExecutionLogRecord {
  return {
    id: Number(row.id),
    schema_version: row.schema_version as typeof RUNTIME_SCHEMA_VERSION,
    claim_token: row.claim_token as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    state: row.state as RuntimeExecutionState,
    reason: row.reason as RuntimeExecutionReason,
    created_at: row.created_at as string,
    payload: row.payload as string,
  };
}

function createRuntimeClaimRecord(
  seed: RuntimeClaimAcquisitionSeed,
  entropy = seed.entropy ?? randomUUID(),
): RuntimeClaim {
  const claimSeed = {
    schema_version: seed.schema_version ?? RUNTIME_SCHEMA_VERSION,
    target_type: seed.target_type,
    target_id: seed.target_id,
    holder: seed.holder,
    created_at: seed.created_at,
    expires_at: seed.expires_at,
    ...(seed.metadata === undefined ? {} : { metadata: seed.metadata }),
    entropy,
  } satisfies Omit<RuntimeClaim, "claim_token"> & { entropy: string };
  return {
    schema_version: claimSeed.schema_version,
    claim_token: createRuntimeClaimToken(claimSeed),
    target_type: claimSeed.target_type,
    target_id: claimSeed.target_id,
    holder: claimSeed.holder,
    created_at: claimSeed.created_at,
    expires_at: claimSeed.expires_at,
    ...(claimSeed.metadata === undefined ? {} : { metadata: claimSeed.metadata }),
  };
}

export function getRuntimeClaimDefaultTtlMilliseconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const idleTimeoutSecondsValue = env.SANDCASTLE_IDLE_TIMEOUT_SECONDS?.trim();
  const idleTimeoutSeconds = Number.parseInt(idleTimeoutSecondsValue ?? "", 10);
  if (Number.isFinite(idleTimeoutSeconds) && idleTimeoutSeconds > 0) {
    return (idleTimeoutSeconds + DEFAULT_RUNTIME_CLAIM_GRACE_SECONDS) * 1000;
  }
  return DEFAULT_RUNTIME_CLAIM_TTL_MINUTES * 60_000;
}

function toRuntimeLockConflictDetail(row: Record<string, unknown>): RuntimeLockConflictDetail {
  return {
    path: row.path as string,
    key: row.key as string,
    owner: {
      claim_token: row.claim_token as string,
      target_type: row.target_type as string,
      target_id: row.target_id as string,
      ...(typeof row.claim_state === "string"
        ? { state: row.claim_state as RuntimeClaimRecord["state"] }
        : {}),
      ...(typeof row.claim_expires_at === "string"
        ? { expires_at: row.claim_expires_at as string }
        : {}),
    },
  };
}

function toRuntimeScopeLockConflictRecord(
  row: Record<string, unknown>,
): RuntimeScopeLockConflictRecord {
  return {
    scope_ref: row.scope_ref as string,
    requested_mode: row.requested_mode as RuntimeScopeLockMode,
    conflicting_modes: String(row.conflicting_modes)
      .split(",")
      .filter((value) => value.length > 0) as RuntimeScopeLockMode[],
    policy_name: row.policy_name as RuntimeScopeLockPolicyName,
    ...(typeof row.claim_token === "string"
      ? {
          owner: {
            claim_token: row.claim_token as string,
            target_type: row.target_type as string,
            target_id: row.target_id as string,
            ...(typeof row.claim_state === "string"
              ? { state: row.claim_state as RuntimeClaimRecord["state"] }
              : {}),
            ...(typeof row.claim_expires_at === "string"
              ? { expires_at: row.claim_expires_at as string }
              : {}),
          },
        }
      : {}),
  };
}

function createRuntimeLockRemovalConflictDetail(
  identity: { path: string; key: string },
  details: Omit<RuntimeLockRemovalConflictDetail, "path" | "key">,
): RuntimeLockRemovalConflictDetail {
  return {
    path: identity.path,
    key: identity.key,
    ...details,
  };
}

function createLockInsertPayload(
  claim: RuntimeClaim,
  identity: { path: string; key: string },
): RuntimeLock {
  return {
    schema_version: claim.schema_version,
    key: identity.key,
    path: identity.path,
    claim_token: claim.claim_token,
    target_type: claim.target_type,
    target_id: claim.target_id,
    created_at: claim.created_at,
    ...(claim.metadata === undefined ? {} : { metadata: claim.metadata }),
  };
}

function createScopeLockInsertPayload(options: {
  claimToken: string;
  scopeRef: string;
  lockMode: RuntimeScopeLockMode;
  policyName: RuntimeScopeLockPolicyName;
  acquiredAt: string;
  metadata?: Record<string, unknown>;
}): RuntimeScopeLock {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    claim_token: options.claimToken,
    scope_ref: options.scopeRef,
    lock_mode: options.lockMode,
    policy_name: options.policyName,
    acquired_at: options.acquiredAt,
    updated_at: options.acquiredAt,
    lifecycle_state: "active",
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

function createClaimTargetScopeLockPayload(claim: RuntimeClaim): RuntimeScopeLock {
  return createScopeLockInsertPayload({
    claimToken: claim.claim_token,
    scopeRef: canonicalizeClaimScopeRef(claim.target_type, claim.target_id),
    lockMode: "execute",
    policyName: runtimeScopeLockPolicyNameForMode("execute"),
    acquiredAt: claim.created_at,
  });
}

function runtimeScopeLockPolicyNameForMode(
  lockMode: RuntimeScopeLockMode,
): RuntimeScopeLockPolicyName {
  switch (lockMode) {
    case "read":
      return "ReadLockPolicy";
    case "write":
      return "WriteLockPolicy";
    case "execute":
      return "ExecuteLockPolicy";
  }
}

function dedupeScopeLocksByIdentity(
  locks: RuntimeScopeLockRecord[],
): RuntimeScopeLockRecord[] {
  const byIdentity = new Map<string, RuntimeScopeLockRecord>();
  for (const lock of locks) {
    const key = `${lock.scope_ref}\u0000${lock.lock_mode}\u0000${lock.policy_name}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, lock);
    }
  }
  return [...byIdentity.values()];
}

function toScopeLockDescriptor(
  lock: Pick<
    RuntimeScopeLockRecord,
    "scope_ref" | "lock_mode" | "policy_name"
  >,
): RuntimeScopeLockDescriptor {
  return {
    scopeRef: lock.scope_ref,
    lockMode: lock.lock_mode,
    policyName: lock.policy_name,
  };
}

function listUniqueScopeLockDescriptors(
  locks: RuntimeScopeLockRecord[],
): RuntimeScopeLockDescriptor[] {
  return dedupeScopeLocksByIdentity(locks).map(toScopeLockDescriptor);
}

function toExecuteScopeLockDescriptors(
  scopeRefs: string[],
): RuntimeScopeLockDescriptor[] {
  return scopeRefs.map((scopeRef) => ({
    scopeRef,
    lockMode: "execute",
    policyName: "ExecuteLockPolicy",
  }));
}

function gitOutput(rootDir: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return undefined;
  }
}

function parseGitChangedFiles(
  raw: string | undefined,
  rootDir: string,
): RuntimeChangedFileAuditEntry[] {
  if (!raw) {
    return [];
  }

  const entries = raw.split("\0").filter((entry) => entry.length > 0);
  const files: RuntimeChangedFileAuditEntry[] = [];
  for (let index = 0; index < entries.length; ) {
    const status = entries[index++]?.trim();
    if (!status) {
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = entries[index++];
      const pathValue = entries[index++];
      if (!previousPath || !pathValue) {
        continue;
      }
      const identity = createRuntimeLockIdentity(pathValue, {
        rootDir,
        cwd: rootDir,
      });
      if (identity.path.startsWith(RUNTIME_INTERNAL_PATH_PREFIX)) {
        continue;
      }
      files.push({
        status,
        path: identity.path,
        key: identity.key,
        previousPath,
      });
      continue;
    }

    const pathValue = entries[index++];
    if (!pathValue) {
      continue;
    }
    const identity = createRuntimeLockIdentity(pathValue, {
      rootDir,
      cwd: rootDir,
    });
    if (identity.path.startsWith(RUNTIME_INTERNAL_PATH_PREFIX)) {
      continue;
    }
    files.push({
      status,
      path: identity.path,
      key: identity.key,
    });
  }

  return files;
}

function parseGitUntrackedFiles(
  raw: string | undefined,
  rootDir: string,
): RuntimeChangedFileAuditEntry[] {
  if (!raw) {
    return [];
  }

  return raw
    .split("\0")
    .filter((entry) => entry.length > 0)
    .flatMap((pathValue) => {
      const identity = createRuntimeLockIdentity(pathValue, {
        rootDir,
        cwd: rootDir,
      });
      if (identity.path.startsWith(RUNTIME_INTERNAL_PATH_PREFIX)) {
        return [];
      }
      return {
        status: "??",
        path: identity.path,
        key: identity.key,
      } satisfies RuntimeChangedFileAuditEntry;
    });
}

function mergeRuntimeChangedFiles(
  primary: RuntimeChangedFileAuditEntry[],
  secondary: RuntimeChangedFileAuditEntry[],
): RuntimeChangedFileAuditEntry[] {
  const merged = new Map<string, RuntimeChangedFileAuditEntry>();
  const put = (entry: RuntimeChangedFileAuditEntry): void => {
    const existing = merged.get(entry.path);
    if (!existing) {
      merged.set(entry.path, entry);
      return;
    }

    const existingIsRename =
      existing.status.startsWith("R") || existing.status.startsWith("C");
    const nextIsRename =
      entry.status.startsWith("R") || entry.status.startsWith("C");
    if (!existingIsRename && nextIsRename) {
      merged.set(entry.path, entry);
      return;
    }
    if (existing.status === "??" && entry.status !== "??") {
      merged.set(entry.path, entry);
    }
  };

  primary.forEach(put);
  secondary.forEach(put);
  return [...merged.values()];
}

function mergeTreeHasConflicts(output: string | undefined): boolean {
  if (!output) {
    return true;
  }
  return (
    output.includes("changed in both") ||
    output.includes("both added") ||
    output.includes("<<<<<<<") ||
    output.includes(">>>>>>>")
  );
}

function runtimeAuditNextCommand(
  state: RuntimeChangedFileAuditLockState,
  claimToken: string,
  pathValue: string,
): string {
  switch (state) {
    case "owned":
      return "";
    case "missing":
      return `dv lock create --claim ${claimToken} ${pathValue}`;
    case "foreign-owned":
      return `dv claim release ${claimToken} --outcome conflict`;
    case "expired":
      return `dv claim release ${claimToken} --outcome expired`;
    case "rename-detected":
      return `dv claim release ${claimToken} --outcome invalid`;
    default:
      return `dv claim release ${claimToken} --outcome invalid`;
  }
}

function runtimeAuditMessage(state: RuntimeChangedFileAuditLockState): string {
  switch (state) {
    case "rename-detected":
      return "Git-detected rename blocks terminal success.";
    case "foreign-owned":
      return "Path is owned by another claim.";
    case "expired":
      return "Claim is expired.";
    case "missing":
    default:
      return "Path is not owned by the current claim.";
  }
}

function resolveRuntimeAuditLockState(options: {
  entry: RuntimeChangedFileAuditEntry;
  claimToken: string;
  lockConflict?: RuntimeLockConflictDetail;
  renamePaths: Set<string>;
}): RuntimeChangedFileAuditLockState {
  const { entry, claimToken, lockConflict, renamePaths } = options;
  if (renamePaths.has(entry.path)) {
    return "rename-detected";
  }
  if (!lockConflict) {
    return "missing";
  }
  if (lockConflict.owner.claim_token !== claimToken) {
    return "foreign-owned";
  }
  if (lockConflict.owner.state === "expired") {
    return "expired";
  }
  return "owned";
}

function buildRuntimeChangedFileAuditDiagnostic(options: {
  entry: RuntimeChangedFileAuditEntry;
  claimToken: string;
  actualLockState: RuntimeChangedFileAuditLockState;
  owner?: RuntimeLockConflictDetail["owner"];
}): RuntimeChangedFileAuditDiagnostic {
  const { entry, claimToken, actualLockState, owner } = options;
  return {
    path: entry.path,
    ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
    expectedClaimToken: claimToken,
    actualLockState,
    owner,
    recommendedNextCommand: runtimeAuditNextCommand(
      actualLockState,
      claimToken,
      entry.path,
    ),
    message: runtimeAuditMessage(actualLockState),
  };
}

function buildRuntimeChangedFileAuditResult(options: {
  claimToken: string;
  claim?: RuntimeClaimRecord;
  mergeTargetRef: string;
  headRef?: string;
  headSha?: string;
  fresh: boolean;
  mergeable: boolean;
  changedFiles: RuntimeChangedFileAuditEntry[];
  renameDiagnostics: RuntimeRenameDiagnostic[];
  diagnostics: RuntimeChangedFileAuditDiagnostic[];
}): RuntimeChangedFileAuditResult {
  return {
    claimToken: options.claimToken,
    ...(options.claim ? { claim: options.claim } : {}),
    mergeTargetRef: options.mergeTargetRef,
    ...(options.headRef ? { headRef: options.headRef } : {}),
    ...(options.headSha ? { headSha: options.headSha } : {}),
    fresh: options.fresh,
    mergeable: options.mergeable,
    changedFiles: options.changedFiles,
    changedPaths: options.changedFiles.map((entry) => entry.path),
    renameDiagnostics: options.renameDiagnostics,
    diagnostics: options.diagnostics,
    passed:
      options.diagnostics.length === 0 &&
      options.renameDiagnostics.length === 0 &&
      options.fresh &&
      options.mergeable,
  };
}

class RuntimeInitialClaimAcquisitionError extends Error {
  readonly claim: RuntimeClaim;
  readonly conflicts: RuntimeLockConflictDetail[];
  readonly mode: "claim" | "lock";

  constructor(options: {
    claim: RuntimeClaim;
    mode: "claim" | "lock";
    conflicts?: RuntimeLockConflictDetail[];
  }) {
    super("Initial runtime claim acquisition conflicted.");
    this.name = "RuntimeInitialClaimAcquisitionError";
    this.claim = options.claim;
    this.mode = options.mode;
    this.conflicts = options.conflicts ?? [];
  }
}

export class RuntimeSqliteStore {
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly rootDir: string;

  constructor(options: RuntimeSqliteStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.databasePath = resolveRuntimeDatabasePath(this.rootDir, options);
    mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath, {
      timeout: RUNTIME_SQLITE_BUSY_TIMEOUT_MS,
    });
    this.database.exec("PRAGMA foreign_keys = ON;");
    initializeRuntimeSchema(this.database);
  }

  close(): void {
    this.database.close();
  }

  withTransaction<T>(callback: () => T): T {
    return runTransaction(this.database, callback);
  }

  private readLockConflict(
    pathValue: string,
    key: string,
  ): RuntimeLockConflictDetail | undefined {
    const row = this.database.prepare(
      `SELECT
        locks.path,
        locks.key,
        locks.claim_token,
        locks.target_type,
        locks.target_id,
        runtime_claims.state AS claim_state,
        runtime_claims.expires_at AS claim_expires_at
       FROM locks
       JOIN runtime_claims ON runtime_claims.claim_token = locks.claim_token
       WHERE locks.path = ? OR locks.key = ?`,
    ).get(pathValue, key) as Record<string, unknown> | undefined;
    return row ? toRuntimeLockConflictDetail(row) : undefined;
  }

  private collectGitAuditContext(mergeTargetRef: string): {
    headRef?: string;
    headSha?: string;
    fresh: boolean;
    mergeable: boolean;
  } {
    const headRef =
      gitOutput(this.rootDir, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() ||
      undefined;
    const headSha = gitOutput(this.rootDir, ["rev-parse", "HEAD"])?.trim();
    const mergeTargetSha = gitOutput(this.rootDir, [
      "rev-parse",
      mergeTargetRef,
    ])?.trim();
    const mergeBaseSha =
      mergeTargetSha && headSha
        ? gitOutput(this.rootDir, ["merge-base", mergeTargetRef, "HEAD"])?.trim()
        : undefined;
    const mergeTreeOutput =
      mergeTargetSha && headSha
        ? gitOutput(this.rootDir, [
            "merge-tree",
            mergeBaseSha ?? mergeTargetRef,
            mergeTargetRef,
            "HEAD",
          ])
        : undefined;
    const hasGitContext = Boolean(headSha || mergeTargetSha);
    const fresh =
      !hasGitContext ||
      (!!mergeTargetSha &&
        !!mergeBaseSha &&
        mergeBaseSha === mergeTargetSha);
    const mergeable =
      !hasGitContext ||
      (!!mergeTargetSha && !!headSha && !mergeTreeHasConflicts(mergeTreeOutput));

    return {
      ...(headRef ? { headRef } : {}),
      ...(headSha ? { headSha } : {}),
      fresh,
      mergeable,
    };
  }

  private normalizeRuntimeLockIdentities(
    paths: string[],
  ): Array<{ path: string; key: string }> {
    const identities = new Map<string, { path: string; key: string }>();
    for (const inputPath of paths) {
      const identity = createRuntimeLockIdentity(inputPath, {
        rootDir: this.rootDir,
        cwd: this.rootDir,
      });
      identities.set(identity.path, identity);
    }
    return [...identities.values()];
  }

  private readRuntimeLockWorktreeStates(
    paths: string[],
  ): Map<string, RuntimeLockWorktreeState> {
    const states = new Map<string, RuntimeLockWorktreeState>();
    for (const inputPath of paths) {
      const output = execFileSync(
        "git",
        [
          "-C",
          this.rootDir,
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--",
          inputPath,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      states.set(
        inputPath,
        output.length > 0 ? "modified" : "clean",
      );
    }
    return states;
  }

  private collectRuntimeLockStatus(
    claimToken: string,
  ): RuntimeLockStatusResult {
    const claim = this.getClaimByToken(claimToken);
    const locks = this.listLocksByClaimToken(claimToken);
    const states = this.readRuntimeLockWorktreeStates(
      locks.map((lock) => lock.path),
    );
    return {
      claimToken,
      ...(claim ? { claim, state: claim.state } : { state: "missing" as const }),
      locks: locks.map((lock) => ({
        ...lock,
        state: states.get(lock.path) ?? "clean",
      })),
    };
  }

  private getLatestExecutionLogEntry(
    claimToken: string,
  ): RuntimeExecutionLogRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM execution_log
       WHERE claim_token = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    ).get(claimToken) as Record<string, unknown> | undefined;
    return row ? toRuntimeExecutionLogRecord(row) : undefined;
  }

  private readClaimCleanupConflict(
    claimToken: string,
  ): RuntimeClaimCleanupConflictDetail | undefined {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      const ownedLocks = this.listLocksByClaimToken(claimToken);
      if (ownedLocks.length > 0) {
        return {
          claim_token: claimToken,
          reason: "inconsistent",
          message:
            "Claim cleanup found owned locks but no matching claim row.",
        };
      }
      return undefined;
    }

    const latestExecutionLogEntry = this.getLatestExecutionLogEntry(claimToken);

    if (claim.state === "active") {
      return {
        claim_token: claim.claim_token,
        target_type: claim.target_type,
        target_id: claim.target_id,
        reason: "active",
        state: claim.state,
        expires_at: claim.expires_at,
        latest_execution_state: latestExecutionLogEntry?.state,
        latest_execution_reason: latestExecutionLogEntry?.reason,
        message: "Claim is still active and cannot be cleaned up.",
      };
    }

    if (latestExecutionLogEntry?.state === "running") {
      return {
        claim_token: claim.claim_token,
        target_type: claim.target_type,
        target_id: claim.target_id,
        reason: "running",
        state: claim.state,
        expires_at: claim.expires_at,
        latest_execution_state: latestExecutionLogEntry.state,
        latest_execution_reason: latestExecutionLogEntry.reason,
        message:
          "Claim is expired but still has a running execution log entry.",
      };
    }

    return undefined;
  }

  private cleanupRuntimeClaims(
    claimTokens: string[],
  ): RuntimeClaimCleanupResult {
    const uniqueTokens = [...new Set(claimTokens)];
    const conflicts = uniqueTokens
      .map((claimToken) => this.readClaimCleanupConflict(claimToken))
      .filter(
        (value): value is RuntimeClaimCleanupConflictDetail =>
          value !== undefined,
      );

    if (conflicts.length > 0) {
      return {
        outcome: "conflict",
        conflicts,
      } satisfies RuntimeClaimCleanupConflict;
    }

    const removed = this.withTransaction(() =>
      uniqueTokens
        .map((claimToken) => {
          const claim = this.getClaimByToken(claimToken);
          if (!claim) {
            return undefined;
          }
          const locksRemoved = this.deleteLocksByClaimToken(claimToken);
          this.deleteClaim(claimToken);
          return {
            claimToken,
            claim,
            locksRemoved,
          } satisfies RuntimeClaimCleanupRemovalRecord;
        })
        .filter(
          (value): value is RuntimeClaimCleanupRemovalRecord =>
            value !== undefined,
        ),
    );

    return {
      outcome: "removed",
      removed,
    } satisfies RuntimeClaimCleanupSuccess;
  }

  private finalizeRuntimeExecution(
    claimToken: string,
    options: {
      state: "completed" | "failed";
      reason: "success" | "error";
      detail: RuntimeExecutionHaltDetail;
    },
  ): RuntimeExecutionTerminalResult {
    const runtimeClaim = this.getClaimByToken(claimToken);
    if (!runtimeClaim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    if (runtimeClaim.state !== "active") {
      throw new Error(`Runtime claim token is not active: ${claimToken}`);
    }

    const { executionLogEntry, locksRemoved } = this.withTransaction(() => {
      const createdAt = new Date().toISOString();
      const executionLogEntry = this.insertExecutionLogEntry({
        schema_version: runtimeClaim.schema_version,
        claim_token: runtimeClaim.claim_token,
        target_type: runtimeClaim.target_type,
        target_id: runtimeClaim.target_id,
        state: options.state,
        reason: options.reason,
        created_at: createdAt,
        detail: options.detail,
      });

      const locksRemoved = this.deleteLocksByClaimToken(claimToken);
      this.deleteClaim(claimToken);
      return { executionLogEntry, locksRemoved };
    });

    return {
      claimToken,
      claim: runtimeClaim,
      locksRemoved,
      executionLogEntry,
    };
  }

  private createRunningExecutionLogEntry(claim: RuntimeClaim): RuntimeExecutionLogEntry {
    return {
      schema_version: claim.schema_version,
      claim_token: claim.claim_token,
      target_type: claim.target_type,
      target_id: claim.target_id,
      state: "running",
      reason: "started",
      created_at: claim.created_at,
      detail: {
        code: "x-runtime-claim-started",
        message: "Runtime claim acquired.",
      },
    };
  }

  private createConflictExecutionLogEntry(
    claim: RuntimeClaim,
    mode: "claim" | "lock",
    conflicts: RuntimeLockConflictDetail[],
  ): RuntimeExecutionLogEntry {
    const detail =
      mode === "claim"
        ? {
            code: "x-runtime-claim-conflict",
            message: "Runtime claim acquisition conflicted.",
          }
        : {
            code: "x-runtime-lock-conflict",
            message: "Runtime lock acquisition conflicted.",
          };

    return {
      schema_version: claim.schema_version,
      claim_token: claim.claim_token,
      target_type: claim.target_type,
      target_id: claim.target_id,
      state: "halted",
      reason: "conflict",
      created_at: claim.created_at,
      detail: {
        code: detail.code,
        message: detail.message,
        ...(conflicts.length > 0 ? { "x-conflicts": conflicts } : {}),
      },
    };
  }

  acquireRuntimeClaim(
    seed: RuntimeClaimAcquisitionSeed,
    options: { initialLockPaths?: string[] } = {},
  ): RuntimeInitialClaimAcquisitionResult {
    const claim = createRuntimeClaimRecord(seed);
    const lockIdentities = this.normalizeRuntimeLockIdentities(
      options.initialLockPaths ?? [],
    );

    try {
      const result = this.withTransaction(() => {
        const existingClaim = this.getClaimByTarget(
          claim.target_type,
          claim.target_id,
        );
        if (existingClaim) {
          throw new RuntimeInitialClaimAcquisitionError({
            claim,
            mode: "claim",
          });
        }

        const conflicts = lockIdentities
          .map((identity) => this.readLockConflict(identity.path, identity.key))
          .filter((value): value is RuntimeLockConflictDetail => value !== undefined);
        if (conflicts.length > 0) {
          throw new RuntimeInitialClaimAcquisitionError({
            claim,
            mode: "lock",
            conflicts,
          });
        }

        const insertedClaim = this.insertClaim(claim);
        const claimScopeLock = this.insertScopeLock(
          createClaimTargetScopeLockPayload(claim),
        );
        const insertedLocks = lockIdentities.map((identity) =>
          this.insertLock(createLockInsertPayload(claim, identity)),
        );
        const runningEntry = this.insertExecutionLogEntry(
          this.createRunningExecutionLogEntry(claim),
        );
        return {
          outcome: "acquired",
          claimToken: claim.claim_token,
          claim: insertedClaim,
          scopeLock: claimScopeLock,
          locks: insertedLocks,
          executionLogEntry: runningEntry,
        } satisfies RuntimeInitialClaimAcquisitionSuccess;
      });
      return result;
    } catch (error) {
      if (!(error instanceof RuntimeInitialClaimAcquisitionError)) {
        throw error;
      }

      const executionLogEntry = this.insertExecutionLogEntry(
        this.createConflictExecutionLogEntry(
          claim,
          error.mode,
          error.conflicts,
        ),
      );
      return {
        outcome: "conflict",
        claimToken: claim.claim_token,
        claim,
        conflicts: error.conflicts,
        executionLogEntry,
      };
    }
  }

  acquireRuntimeLocks(
    claimToken: string,
    paths: string[],
  ): RuntimeLockAcquisitionResult {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    if (claim.state === "active") {
      this.touchClaimContext(claimToken, { renew: true });
    }
    const lockIdentities = this.normalizeRuntimeLockIdentities(paths);
    if (claim.state === "expired") {
      return {
        outcome: "conflict",
        claimToken,
        conflicts: lockIdentities.map((identity) => ({
          path: identity.path,
          key: identity.key,
          owner: {
            claim_token: claim.claim_token,
            target_type: claim.target_type,
            target_id: claim.target_id,
            state: claim.state,
            expires_at: claim.expires_at,
          },
        })),
      };
    }
    return this.withTransaction(() => {
      const conflicts = lockIdentities
        .map((identity) => {
          const conflict = this.readLockConflict(identity.path, identity.key);
          if (!conflict || conflict.owner.claim_token === claimToken) {
            return undefined;
          }
          return conflict;
        })
        .filter(
          (value): value is RuntimeLockConflictDetail => value !== undefined,
        );

      if (conflicts.length > 0) {
        return {
          outcome: "conflict",
          claimToken,
          conflicts,
        } satisfies RuntimeLockAcquisitionConflict;
      }

      const locks = lockIdentities.map((identity) => {
        const existing = this.getLockByPath(identity.path);
        if (existing) {
          return existing;
        }
        return this.insertLock(createLockInsertPayload(claim, identity));
      });

      return {
        outcome: "acquired",
        claimToken,
        locks,
      } satisfies RuntimeLockAcquisitionSuccess;
    });
  }

  removeRuntimeLocks(
    claimToken: string,
    paths: string[],
  ): RuntimeLockRemovalResult {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    if (claim.state === "active") {
      this.touchClaimContext(claimToken, { renew: true });
    }

    let lockIdentities: Array<{ path: string; key: string }>;
    try {
      lockIdentities = this.normalizeRuntimeLockIdentities(paths);
    } catch (error) {
      return {
        outcome: "conflict",
        claimToken,
        conflicts: [
          createRuntimeLockRemovalConflictDetail(
            { path: paths[0] ?? "", key: "" },
            {
              reason: "invalid-target",
              message:
                error instanceof Error ? error.message : "Invalid lock target.",
            },
          ),
        ],
      };
    }
    const worktreeStates = this.readRuntimeLockWorktreeStates(
      lockIdentities.map((identity) => identity.path),
    );

    const conflicts: RuntimeLockRemovalConflictDetail[] = [];
    for (const identity of lockIdentities) {
      const lock = this.getLockByPath(identity.path);
      const worktreeState = worktreeStates.get(identity.path) ?? "clean";
      if (!lock) {
        conflicts.push(
          createRuntimeLockRemovalConflictDetail(identity, {
            reason: worktreeState === "modified" ? "modified" : "missing",
            state: worktreeState,
            message:
              worktreeState === "modified"
                ? "Lock path is modified."
                : "Lock path is not owned by the claim.",
          }),
        );
        continue;
      }
      if (lock.claim_token !== claimToken) {
        conflicts.push(
          createRuntimeLockRemovalConflictDetail(lock, {
            reason: "foreign-owned",
            state: worktreeState,
            owner: {
              claim_token: lock.claim_token,
              target_type: lock.target_type,
              target_id: lock.target_id,
            },
            message: "Lock is owned by another claim.",
          }),
        );
        continue;
      }
      if (worktreeState === "modified") {
        conflicts.push(
          createRuntimeLockRemovalConflictDetail(lock, {
            reason: "modified",
            state: worktreeState,
            owner: {
              claim_token: lock.claim_token,
              target_type: lock.target_type,
              target_id: lock.target_id,
            },
            message: "Lock path is modified.",
          }),
        );
      }
    }

    if (conflicts.length > 0) {
      return {
        outcome: "conflict",
        claimToken,
        conflicts,
      };
    }

    const removed = this.withTransaction(() => {
      const removedLocks: RuntimeLockRecord[] = [];
      for (const identity of lockIdentities) {
        const lock = this.getLockByPath(identity.path);
        if (!lock || lock.claim_token !== claimToken) {
          continue;
        }
        this.database
          .prepare("DELETE FROM locks WHERE path = ? AND claim_token = ?")
          .run(identity.path, claimToken);
        removedLocks.push(lock);
      }
      return removedLocks;
    });

    return {
      outcome: "removed",
      claimToken,
      removed,
    };
  }

  removeRuntimeScopeLocks(
    claimToken: string,
    scopeRefs: string[],
  ): {
    outcome: "removed";
    claimToken: string;
    removed: RuntimeScopeLockRecord[];
  } | {
    outcome: "conflict";
    claimToken: string;
    conflicts: RuntimeScopeLockConflictRecord[];
  } {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    const normalizedScopeRefs = [
      ...new Set(
        scopeRefs.map((scopeRef) =>
          canonicalizeClaimScopeRef(claim.target_type, scopeRef),
        ),
      ),
    ];

    if (claim.state === "expired") {
      return {
        outcome: "conflict",
        claimToken,
        conflicts: this.createExpiredClaimConflicts(
          claim,
          toExecuteScopeLockDescriptors(normalizedScopeRefs),
        ),
      };
    }

    const removed = this.withTransaction(() => {
      const removedLocks: RuntimeScopeLockRecord[] = [];
      for (const scopeRef of normalizedScopeRefs) {
        const rows = this.database.prepare(
          `SELECT * FROM claim_scope_locks
           WHERE claim_token = ? AND scope_ref = ? AND lifecycle_state = 'active'
           ORDER BY acquired_at, lock_mode`,
        ).all(claimToken, scopeRef) as Record<string, unknown>[];
        for (const row of rows) {
          const record = toRuntimeScopeLockRecord(row);
          const releasedAt = new Date().toISOString();
          this.database.prepare(
            `UPDATE claim_scope_locks
             SET lifecycle_state = 'released',
                 released_at = ?,
                 updated_at = ?
             WHERE claim_token = ? AND scope_ref = ? AND lock_mode = ?`,
          ).run(releasedAt, releasedAt, claimToken, scopeRef, record.lock_mode);
          removedLocks.push({
            ...record,
            lifecycle_state: "released",
            released_at: releasedAt,
            updated_at: releasedAt,
          });
        }
      }
      return removedLocks;
    });

    return {
      outcome: "removed",
      claimToken,
      removed,
    };
  }

  pruneRuntimeClaims(cutoff: Date): RuntimeClaimCleanupResult {
    const cutoffTime = cutoff.getTime();
    const claimTokens = this.listClaims()
      .filter((claim) => new Date(claim.expires_at).getTime() <= cutoffTime)
      .map((claim) => claim.claim_token);
    return this.cleanupRuntimeClaims(claimTokens);
  }

  removeRuntimeClaim(claimToken: string): RuntimeClaimCleanupResult {
    return this.cleanupRuntimeClaims([claimToken]);
  }

  haltRuntimeExecution(
    claimToken: string,
    options: RuntimeExecutionHaltOptions,
  ): RuntimeExecutionHaltResult {
    const runtimeClaim = this.getClaimByToken(claimToken);
    if (!runtimeClaim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }

    const { executionLogEntry, locksRemoved } = this.withTransaction(() => {
      const createdAt = new Date().toISOString();
      const executionLogEntry = this.insertExecutionLogEntry({
        schema_version: runtimeClaim.schema_version,
        claim_token: runtimeClaim.claim_token,
        target_type: runtimeClaim.target_type,
        target_id: runtimeClaim.target_id,
        state: "halted",
        reason: options.reason,
        created_at: createdAt,
        detail: options.detail,
      });

      const locksRemoved = this.deleteLocksByClaimToken(claimToken);
      this.deleteClaim(claimToken);
      return { executionLogEntry, locksRemoved };
    });

    return {
      claimToken,
      claim: runtimeClaim,
      locksRemoved,
      executionLogEntry,
    };
  }

  completeRuntimeExecution(claimToken: string): RuntimeExecutionTerminalResult {
    return this.finalizeRuntimeExecution(claimToken, {
      state: "completed",
      reason: "success",
      detail: {
        code: "x-runtime-claim-released",
        message: "Runtime claim released successfully.",
      },
    });
  }

  failRuntimeExecution(claimToken: string): RuntimeExecutionTerminalResult {
    return this.finalizeRuntimeExecution(claimToken, {
      state: "failed",
      reason: "error",
      detail: {
        code: "x-runtime-claim-failed",
        message: "Runtime claim failed.",
      },
    });
  }

  getLockStatus(claimToken: string): RuntimeLockStatusResult {
    return this.collectRuntimeLockStatus(claimToken);
  }

  auditChangedFiles(
    claimToken: string,
    options: { mergeTargetRef?: string } = {},
  ): RuntimeChangedFileAuditResult {
    const claim = this.getClaimByToken(claimToken);
    const mergeTargetRef = options.mergeTargetRef ?? "HEAD";
    const { headRef, headSha, fresh, mergeable } =
      this.collectGitAuditContext(mergeTargetRef);

    const branchChanges = parseGitChangedFiles(
      gitOutput(this.rootDir, [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        `${mergeTargetRef}...HEAD`,
      ]),
      this.rootDir,
    );
    const worktreeChanges = parseGitChangedFiles(
      gitOutput(this.rootDir, [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "HEAD",
      ]),
      this.rootDir,
    );
    const untrackedChanges = parseGitUntrackedFiles(
      gitOutput(this.rootDir, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
      this.rootDir,
    );
    const changedFiles = mergeRuntimeChangedFiles(
      mergeRuntimeChangedFiles(branchChanges, worktreeChanges),
      untrackedChanges,
    );
    const renameDiagnostics = detectRuntimeRenameDiagnostics(changedFiles);
    const renamePaths = new Set(
      renameDiagnostics.flatMap((diagnostic) => {
        const paths = [diagnostic.details.path];
        if (diagnostic.details.previousPath) {
          paths.push(diagnostic.details.previousPath);
        }
        return paths;
      }),
    );
    const diagnostics: RuntimeChangedFileAuditDiagnostic[] = [];

    for (const entry of changedFiles) {
      const lockConflict = this.readLockConflict(entry.path, entry.key);
      const actualLockState = resolveRuntimeAuditLockState({
        entry,
        claimToken,
        lockConflict,
        renamePaths,
      });
      if (actualLockState === "owned") {
        continue;
      }

      diagnostics.push(
        buildRuntimeChangedFileAuditDiagnostic({
          entry,
          claimToken,
          actualLockState,
          owner: lockConflict?.owner,
        }),
      );
    }

    return buildRuntimeChangedFileAuditResult({
      claimToken,
      claim,
      mergeTargetRef,
      headRef,
      headSha,
      fresh,
      mergeable,
      changedFiles,
      renameDiagnostics,
      diagnostics,
    });
  }

  auditClaimedPaths(
    claimToken: string,
    paths: string[],
    options: { mergeTargetRef?: string } = {},
  ): RuntimeChangedFileAuditResult {
    const claim = this.getClaimByToken(claimToken);
    const mergeTargetRef = options.mergeTargetRef ?? "HEAD";
    const { headRef, headSha, fresh, mergeable } =
      this.collectGitAuditContext(mergeTargetRef);
    const emptyRenamePaths = new Set<string>();
    const changedFiles = this.normalizeRuntimeLockIdentities(paths).map(
      (entry) => ({
        status: "M",
        path: entry.path,
        key: entry.key,
      }),
    );
    const diagnostics: RuntimeChangedFileAuditDiagnostic[] = [];

    for (const entry of changedFiles) {
      const lockConflict = this.readLockConflict(entry.path, entry.key);
      const actualLockState = resolveRuntimeAuditLockState({
        entry,
        claimToken,
        lockConflict,
        renamePaths: emptyRenamePaths,
      });
      if (actualLockState === "owned") {
        continue;
      }

      diagnostics.push(
        buildRuntimeChangedFileAuditDiagnostic({
          entry,
          claimToken,
          actualLockState,
          owner: lockConflict?.owner,
        }),
      );
    }

    return buildRuntimeChangedFileAuditResult({
      claimToken,
      claim,
      mergeTargetRef,
      headRef,
      headSha,
      fresh,
      mergeable,
      changedFiles,
      renameDiagnostics: [],
      diagnostics,
    });
  }

  insertClaim(claim: unknown): RuntimeClaimRecord {
    assertRuntimeClaim(claim);
    this.database.prepare(
      `INSERT INTO claims (
        schema_version,
        claim_token,
        target_type,
        target_id,
        holder,
        expires_at,
        created_at,
        updated_at,
        last_seen_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      claim.schema_version,
      claim.claim_token,
      claim.target_type,
      claim.target_id,
      claim.holder,
      claim.expires_at,
      claim.created_at,
      claim.created_at,
      claim.last_seen_at ?? claim.created_at,
      claim.metadata === undefined ? null : stringifyCanonicalJson(claim.metadata),
    );
    return this.getClaimByToken(claim.claim_token)!;
  }

  touchClaimContext(
    claimToken: string,
    options: RuntimeClaimTouchOptions = {},
  ): RuntimeClaimRecord {
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const current = this.getClaimByToken(claimToken);
    if (!current) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    const expiresAt = options.renew
      ? new Date(
          now.getTime() +
            (options.ttlMilliseconds ?? getRuntimeClaimDefaultTtlMilliseconds()),
        ).toISOString()
      : current.expires_at;
    this.database.prepare(
      `UPDATE claims
       SET last_seen_at = ?, updated_at = ?, expires_at = ?
       WHERE claim_token = ?`,
    ).run(nowIso, nowIso, expiresAt, claimToken);
    return this.getClaimByToken(claimToken)!;
  }

  renewRuntimeClaim(
    claimToken: string,
    options: RuntimeClaimRenewalOptions = {},
  ): RuntimeClaimRenewalResult {
    return this.withTransaction(() =>
      this.renewRuntimeClaimWithinTransaction(claimToken, options),
    );
  }

  private listActiveScopeLocksByClaimToken(
    claimToken: string,
  ): RuntimeScopeLockRecord[] {
    return this.listScopeLocksByClaimToken(claimToken).filter(
      (lock) => lock.lifecycle_state === "active",
    );
  }

  private createScopeLockConflictOwner(
    claim: RuntimeClaimRecord,
  ): NonNullable<RuntimeScopeLockConflictRecord["owner"]> {
    return {
      claim_token: claim.claim_token,
      target_type: claim.target_type,
      target_id: claim.target_id,
      state: claim.state,
      expires_at: claim.expires_at,
    };
  }

  private createExpiredClaimConflict(
    claim: RuntimeClaimRecord,
    lock: RuntimeScopeLockDescriptor,
  ): RuntimeScopeLockConflictRecord {
    return {
      scope_ref: lock.scopeRef,
      requested_mode: lock.lockMode,
      conflicting_modes: [lock.lockMode],
      policy_name: lock.policyName,
      owner: this.createScopeLockConflictOwner(claim),
    };
  }

  private createExpiredClaimConflicts(
    claim: RuntimeClaimRecord,
    locks: RuntimeScopeLockDescriptor[],
  ): RuntimeScopeLockConflictRecord[] {
    return locks.map((lock) => this.createExpiredClaimConflict(claim, lock));
  }

  private listScopeLockConflicts(
    locks: RuntimeScopeLockDescriptor[],
    options: { excludeClaimToken?: string } = {},
  ): RuntimeScopeLockConflictRecord[] {
    return locks
      .map((lock) =>
        this.readScopeLockConflict(
          lock.scopeRef,
          lock.lockMode,
          lock.policyName,
          options,
        ),
      )
      .filter(
        (value): value is RuntimeScopeLockConflictRecord => value !== undefined,
      );
  }

  private normalizeScopeLockRequests(
    claim: RuntimeClaimRecord,
    locks: RuntimeScopeLockAcquisitionRequest[],
  ): RuntimeNormalizedScopeLockRequest[] {
    return locks.map((request) => ({
      scopeRef: canonicalizeClaimScopeRef(claim.target_type, request.scopeRef),
      lockMode: request.lockMode,
      policyName:
        request.policyName ?? runtimeScopeLockPolicyNameForMode(request.lockMode),
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    }));
  }

  private renewRuntimeClaimWithinTransaction(
    claimToken: string,
    options: RuntimeClaimRenewalOptions = {},
  ): RuntimeClaimRenewalResult {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }

    const activeLockDescriptors = listUniqueScopeLockDescriptors(
      this.listActiveScopeLocksByClaimToken(claimToken),
    );
    if (claim.state === "expired") {
      return {
        outcome: "conflict",
        claimToken,
        conflicts: this.createExpiredClaimConflicts(
          claim,
          activeLockDescriptors,
        ),
      } satisfies RuntimeClaimRenewalConflict;
    }

    const conflicts = this.listScopeLockConflicts(activeLockDescriptors, {
      excludeClaimToken: claimToken,
    });
    if (conflicts.length > 0) {
      return {
        outcome: "conflict",
        claimToken,
        conflicts,
      } satisfies RuntimeClaimRenewalConflict;
    }

    return {
      outcome: "renewed",
      claimToken,
      claim: this.touchClaimContext(claimToken, {
        now: options.now,
        renew: true,
        ttlMilliseconds: options.ttlMilliseconds,
      }),
    } satisfies RuntimeClaimRenewalSuccess;
  }

  getClaimByToken(claimToken: string): RuntimeClaimRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM runtime_claims WHERE claim_token = ?`,
    ).get(claimToken) as Record<string, unknown> | undefined;
    return row ? toRuntimeClaimRecord(row) : undefined;
  }

  getClaimByTarget(
    targetType: string,
    targetId: string,
  ): RuntimeClaimRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM runtime_claims WHERE target_type = ? AND target_id = ?`,
    ).get(targetType, targetId) as Record<string, unknown> | undefined;
    return row ? toRuntimeClaimRecord(row) : undefined;
  }

  listClaims(): RuntimeClaimRecord[] {
    const rows = this.database.prepare(
      `SELECT * FROM runtime_claims ORDER BY created_at, claim_token`,
    ).all() as Record<string, unknown>[];
    return rows.map(toRuntimeClaimRecord);
  }

  deleteClaim(claimToken: string): number {
    return Number(
      this.database.prepare("DELETE FROM claims WHERE claim_token = ?").run(
        claimToken,
      ).changes,
    );
  }

  insertLock(lock: unknown): RuntimeLockRecord {
    assertRuntimeLock(lock);
    this.database.prepare(
      `INSERT INTO locks (
        schema_version,
        key,
        path,
        claim_token,
        target_type,
        target_id,
        created_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lock.schema_version,
      lock.key,
      lock.path,
      lock.claim_token,
      lock.target_type,
      lock.target_id,
      lock.created_at,
      lock.metadata === undefined ? null : stringifyCanonicalJson(lock.metadata),
    );
    return this.getLockByKey(lock.key)!;
  }

  getLockByKey(lockKey: string): RuntimeLockRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM locks WHERE key = ?`,
    ).get(lockKey) as Record<string, unknown> | undefined;
    return row ? toRuntimeLockRecord(row) : undefined;
  }

  getLockByPath(lockPath: string): RuntimeLockRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM locks WHERE path = ?`,
    ).get(lockPath) as Record<string, unknown> | undefined;
    return row ? toRuntimeLockRecord(row) : undefined;
  }

  listLocks(): RuntimeLockRecord[] {
    const rows = this.database.prepare(
      `SELECT * FROM locks ORDER BY created_at, path`,
    ).all() as Record<string, unknown>[];
    return rows.map(toRuntimeLockRecord);
  }

  listLocksByClaimToken(claimToken: string): RuntimeLockRecord[] {
    const rows = this.database.prepare(
      `SELECT * FROM locks WHERE claim_token = ? ORDER BY created_at, path`,
    ).all(claimToken) as Record<string, unknown>[];
    return rows.map(toRuntimeLockRecord);
  }

  listScopeLocks(): RuntimeScopeLockRecord[] {
    const rows = this.database.prepare(
      `SELECT * FROM claim_scope_locks
       ORDER BY acquired_at, scope_ref, lock_mode`,
    ).all() as Record<string, unknown>[];
    return rows.map(toRuntimeScopeLockRecord);
  }

  listScopeLocksByClaimToken(
    claimToken: string,
  ): RuntimeScopeLockRecord[] {
    const rows = this.database.prepare(
      `SELECT * FROM claim_scope_locks
       WHERE claim_token = ?
       ORDER BY acquired_at, scope_ref, lock_mode`,
    ).all(claimToken) as Record<string, unknown>[];
    return rows.map(toRuntimeScopeLockRecord);
  }

  private readScopeLockConflict(
    scopeRef: string,
    requestedMode: RuntimeScopeLockMode,
    policyName: RuntimeScopeLockPolicyName,
    options: { excludeClaimToken?: string } = {},
  ): RuntimeScopeLockConflictRecord | undefined {
    const rows = this.database.prepare(
      `SELECT
        claim_scope_locks.scope_ref,
        claim_scope_locks.claim_token,
        claim_scope_locks.lock_mode,
        claim_scope_locks.policy_name,
        runtime_claims.target_type,
        runtime_claims.target_id,
        runtime_claims.state AS claim_state,
        runtime_claims.expires_at AS claim_expires_at
       FROM claim_scope_locks
       JOIN runtime_claims ON runtime_claims.claim_token = claim_scope_locks.claim_token
       WHERE claim_scope_locks.scope_ref = ?
         AND claim_scope_locks.lifecycle_state = 'active'
       ORDER BY claim_scope_locks.acquired_at, claim_scope_locks.lock_mode`,
    ).all(scopeRef) as Array<Record<string, unknown>>;
    const activeLocks = rows.filter(
      (row) => row.claim_token !== options.excludeClaimToken,
    );

    const existingModes = activeLocks.map(
      (row) => row.lock_mode as RuntimeScopeLockMode,
    );
    const decision = evaluateRuntimeScopeLockPolicy(
      requestedMode,
      existingModes,
      scopeRef,
      policyName,
    );
    if (decision.allowed) {
      return undefined;
    }

    const first = activeLocks[0];
    return {
      scope_ref: scopeRef,
      requested_mode: requestedMode,
      conflicting_modes: decision.conflict?.conflicting_modes ?? [],
      policy_name: policyName,
      ...(first
        ? {
            owner: {
              claim_token: first.claim_token as string,
              target_type: first.target_type as string,
              target_id: first.target_id as string,
              ...(typeof first.claim_state === "string"
                ? { state: first.claim_state as RuntimeClaimRecord["state"] }
                : {}),
              ...(typeof first.claim_expires_at === "string"
                ? { expires_at: first.claim_expires_at as string }
                : {}),
            },
          }
        : {}),
    };
  }

  insertScopeLock(lock: unknown): RuntimeScopeLockRecord {
    assertRuntimeScopeLock(lock);
    this.database.prepare(
      `INSERT INTO claim_scope_locks (
        schema_version,
        claim_token,
        scope_ref,
        lock_mode,
        policy_name,
        acquired_at,
        updated_at,
        lifecycle_state,
        released_at,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lock.schema_version,
      lock.claim_token,
      lock.scope_ref,
      lock.lock_mode,
      lock.policy_name,
      lock.acquired_at,
      lock.updated_at,
      lock.lifecycle_state,
      lock.released_at ?? null,
      lock.metadata === undefined ? null : stringifyCanonicalJson(lock.metadata),
    );
    return this.getScopeLockByClaimTokenAndScopeRef(
      lock.claim_token,
      lock.scope_ref,
      lock.lock_mode,
    )!;
  }

  getScopeLockByClaimTokenAndScopeRef(
    claimToken: string,
    scopeRef: string,
    lockMode: RuntimeScopeLockMode,
  ): RuntimeScopeLockRecord | undefined {
    const row = this.database.prepare(
      `SELECT * FROM claim_scope_locks
       WHERE claim_token = ? AND scope_ref = ? AND lock_mode = ?`,
    ).get(claimToken, scopeRef, lockMode) as Record<string, unknown> | undefined;
    return row ? toRuntimeScopeLockRecord(row) : undefined;
  }

  acquireRuntimeScopeLocks(
    claimToken: string,
    requestedLocks: RuntimeScopeLockAcquisitionRequest[],
  ): RuntimeScopeLockAcquisitionResult {
    const claim = this.getClaimByToken(claimToken);
    if (!claim) {
      throw new Error(`Unknown runtime claim token: ${claimToken}`);
    }
    if (claim.state === "expired") {
      return {
        outcome: "conflict",
        claimToken,
        conflicts: this.createExpiredClaimConflicts(
          claim,
          this.normalizeScopeLockRequests(claim, requestedLocks),
        ),
      };
    }
    const normalizedRequests = this.normalizeScopeLockRequests(
      claim,
      requestedLocks,
    );

    return this.withTransaction(() => {
      const renewed = this.renewRuntimeClaimWithinTransaction(claimToken);
      if (renewed.outcome === "conflict") {
        return {
          outcome: "conflict",
          claimToken,
          conflicts: renewed.conflicts,
        } satisfies RuntimeScopeLockAcquisitionConflict;
      }

      const conflicts = this.listScopeLockConflicts(normalizedRequests);
      if (conflicts.length > 0) {
        return {
          outcome: "conflict",
          claimToken,
          conflicts,
        } satisfies RuntimeScopeLockAcquisitionConflict;
      }

      const acquired = normalizedRequests.map((request) =>
        this.insertScopeLock(
          createScopeLockInsertPayload({
            claimToken,
            scopeRef: request.scopeRef,
            lockMode: request.lockMode,
            policyName: request.policyName,
            acquiredAt: new Date().toISOString(),
            ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
          }),
        ),
      );

      return {
        outcome: "acquired",
        claimToken,
        locks: acquired,
      } satisfies RuntimeScopeLockAcquisitionSuccess;
    });
  }

  deleteLocksByClaimToken(claimToken: string): number {
    return Number(
      this.database.prepare("DELETE FROM locks WHERE claim_token = ?").run(
        claimToken,
      ).changes,
    );
  }

  insertExecutionLogEntry(
    entry: unknown,
  ): RuntimeExecutionLogRecord {
    assertRuntimeExecutionLogEntry(entry);
    const executionLogEntry = entry as RuntimeExecutionLogInsert;
    const payload = stringifyCanonicalJson(executionLogEntry);
    const values: [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ] = [
      executionLogEntry.schema_version,
      executionLogEntry.claim_token,
      executionLogEntry.target_type,
      executionLogEntry.target_id,
      executionLogEntry.state,
      executionLogEntry.reason,
      executionLogEntry.created_at,
      payload,
    ];
    const result = this.database.prepare(
      `INSERT INTO execution_log (
        schema_version,
        claim_token,
        target_type,
        target_id,
        state,
        reason,
        created_at,
        payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values);
    const row = this.database.prepare(
      `SELECT * FROM execution_log WHERE id = ?`,
    ).get(Number(result.lastInsertRowid)) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new Error("Failed to read back inserted runtime execution log row.");
    }
    return toRuntimeExecutionLogRecord(row);
  }

  listExecutionLogEntries(
    claimToken?: string,
  ): RuntimeExecutionLogRecord[] {
    const rows = claimToken
      ? (this.database.prepare(
          `SELECT * FROM execution_log WHERE claim_token = ? ORDER BY created_at, id`,
        ).all(claimToken) as Record<string, unknown>[])
      : (this.database.prepare(
          `SELECT * FROM execution_log ORDER BY created_at, id`,
        ).all() as Record<string, unknown>[]);
    return rows.map(toRuntimeExecutionLogRecord);
  }
}

export function openRuntimeSqliteStore(
  options: RuntimeSqliteStoreOptions = {},
): RuntimeSqliteStore {
  return new RuntimeSqliteStore(options);
}
