import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertActiveRuntimeClaimForTask, resolveRuntimeClaimAuthority, RuntimeClaimSqliteDataAdapter } from "../runtime-claim/index.js";

export const WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY = "work.running-checklist-composition.v1";

export interface RunningChecklistComposition {
  checklistId: string;
  checkId: string;
  action: "complete" | "clear";
}

export interface RunningChecklistCompositionPayload {
  scope: [string];
  operation: "running-checklist-composition";
  composition: RunningChecklistComposition;
  expiresAt?: string;
  maxUses?: number;
}

export interface Escalation {
  id: string;
  policy: typeof WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY;
  payload: RunningChecklistCompositionPayload;
  createdAt: string;
  uses: number;
  consumptionEvents: Array<{ workItemId: string; usedAt: string }>;
}

/** A Work-owned source mutation that can be undone if use finalization fails. */
export interface EscalationApplication<T> {
  readonly result: T;
  compensate(): Promise<void>;
}

/** Durable identity of the one claimed Work mutation an escalation may apply. */
export interface EscalationUseOperation {
  readonly id: string;
  readonly sagaId: string;
  readonly escalationId: string;
  readonly workItemId: string;
  readonly scope: [string];
  readonly reservationId: string;
  readonly claimToken: string;
  readonly workFilePath: string;
  readonly expectedWorkHash: string;
  readonly desiredWorkHash: string;
  readonly workMutationId: string;
  readonly expectedWorkRevision: string;
  readonly phase: "reserved" | "mutation-intent" | "mutation-applied" | "completed" | "released" | "disputed";
  readonly effectAttemptedAt?: string;
  readonly effectExpiresAt?: string;
  readonly mutationAppliedAt?: string;
}

export class EscalationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function databasePath(rootDir: string): string {
  return resolveRuntimeClaimAuthority(rootDir).databasePath;
}

function open(rootDir: string): DatabaseSync {
  const filePath = databasePath(rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath, { timeout: 5_000 });
  database.exec(`
    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      policy TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS escalation_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escalation_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      used_at TEXT NOT NULL,
      operation_id TEXT,
      FOREIGN KEY (escalation_id) REFERENCES escalations(id)
    );
    CREATE TABLE IF NOT EXISTS escalation_reservations (
      id TEXT PRIMARY KEY,
      escalation_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      FOREIGN KEY (escalation_id) REFERENCES escalations(id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS escalation_use_operations (
      id TEXT PRIMARY KEY,
      saga_id TEXT NOT NULL,
      escalation_id TEXT NOT NULL,
      work_item_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      reservation_id TEXT NOT NULL UNIQUE,
      claim_token TEXT NOT NULL,
      work_file_path TEXT NOT NULL,
      expected_work_hash TEXT NOT NULL,
      desired_work_hash TEXT NOT NULL,
      work_mutation_id TEXT NOT NULL,
      expected_work_revision TEXT NOT NULL,
      phase TEXT NOT NULL,
      effect_attempted_at TEXT,
      effect_expires_at TEXT,
      mutation_applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
  const columns = database.prepare("PRAGMA table_info(escalation_uses)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "operation_id")) database.exec("ALTER TABLE escalation_uses ADD COLUMN operation_id TEXT");
  const operationColumns = database.prepare("PRAGMA table_info(escalation_use_operations)").all() as Array<{ name: string }>;
  if (!operationColumns.some((column) => column.name === "effect_attempted_at")) database.exec("ALTER TABLE escalation_use_operations ADD COLUMN effect_attempted_at TEXT");
  if (!operationColumns.some((column) => column.name === "effect_expires_at")) database.exec("ALTER TABLE escalation_use_operations ADD COLUMN effect_expires_at TEXT");
  if (!operationColumns.some((column) => column.name === "mutation_applied_at")) database.exec("ALTER TABLE escalation_use_operations ADD COLUMN mutation_applied_at TEXT");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_escalation_uses_operation ON escalation_uses(operation_id) WHERE operation_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_escalation_use_operations_pending ON escalation_use_operations(escalation_id, phase, created_at);
  `);
  return database;
}

function fail(code: string, message: string): never {
  throw new EscalationError(code, message);
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail("ESCALATION_INVALID_PAYLOAD", `${field} must be a non-empty string.`);
  return value.trim();
}

function normalizePayload(value: unknown): RunningChecklistCompositionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ESCALATION_INVALID_PAYLOAD", "Escalation payload must be an object.");
  const payload = value as Record<string, unknown>;
  const allowed = new Set(["scope", "operation", "composition", "expiresAt", "maxUses"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("ESCALATION_INVALID_PAYLOAD", "Escalation payload has unsupported fields.");
  if (!Array.isArray(payload.scope) || payload.scope.length !== 1) fail("ESCALATION_SCOPE_REQUIRED", "Escalation scope must contain exactly one Work Item ID.");
  const scope = asNonEmptyString(payload.scope[0], "scope[0]").toLowerCase();
  if (!/^wi-[a-z0-9][a-z0-9-]*$/.test(scope)) fail("ESCALATION_SCOPE_INVALID", "Escalation scope must contain a canonical Work Item ID.");
  if (payload.operation !== "running-checklist-composition") fail("ESCALATION_OPERATION_INVALID", "Escalation operation must be running-checklist-composition.");
  if (!payload.composition || typeof payload.composition !== "object" || Array.isArray(payload.composition)) fail("ESCALATION_COMPOSITION_REQUIRED", "Escalation requires a checklist composition.");
  const composition = payload.composition as Record<string, unknown>;
  const checklistId = asNonEmptyString(composition.checklistId, "composition.checklistId");
  const checkId = asNonEmptyString(composition.checkId, "composition.checkId");
  if (composition.action !== "complete" && composition.action !== "clear") fail("ESCALATION_COMPOSITION_INVALID", "Composition action must be complete or clear.");
  const expiresAt = payload.expiresAt === undefined ? undefined : asNonEmptyString(payload.expiresAt, "expiresAt");
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) fail("ESCALATION_EXPIRY_INVALID", "expiresAt must be an ISO timestamp.");
  const maxUses = payload.maxUses === undefined ? undefined : payload.maxUses;
  if (maxUses !== undefined && (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses <= 0)) fail("ESCALATION_MAX_USES_INVALID", "maxUses must be a positive integer.");
  if (!expiresAt && maxUses === undefined) fail("ESCALATION_BOUND_REQUIRED", "Escalation requires expiresAt or maxUses.");
  return { scope: [scope], operation: "running-checklist-composition", composition: { checklistId, checkId, action: composition.action }, ...(expiresAt ? { expiresAt } : {}), ...(maxUses === undefined ? {} : { maxUses }) };
}

function toEscalation(row: Record<string, unknown>): Escalation {
  return {
    id: String(row.id),
    policy: String(row.policy) as typeof WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY,
    payload: normalizePayload(JSON.parse(String(row.payload))),
    createdAt: String(row.created_at),
    uses: Number(row.uses),
    consumptionEvents: [],
  };
}

export function createEscalation(options: { rootDir?: string; policy: string; payload: unknown }): Escalation {
  if (options.policy !== WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY) fail("ESCALATION_POLICY_UNKNOWN", `Unknown escalation policy '${options.policy}'.`);
  const payload = normalizePayload(options.payload);
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    const escalation: Escalation = { id: `esc-${randomUUID()}`, policy: WORK_RUNNING_CHECKLIST_COMPOSITION_POLICY, payload, createdAt: new Date().toISOString(), uses: 0, consumptionEvents: [] };
    database.prepare("INSERT INTO escalations (id, policy, payload, created_at, uses) VALUES (?, ?, ?, ?, ?)").run(escalation.id, escalation.policy, JSON.stringify(escalation.payload), escalation.createdAt, escalation.uses);
    return escalation;
  } finally {
    database.close();
  }
}

export function getEscalation(options: { rootDir?: string; escalationId: string }): Escalation {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    const row = database.prepare("SELECT * FROM escalations WHERE id = ?").get(options.escalationId) as Record<string, unknown> | undefined;
    if (!row) fail("ESCALATION_NOT_FOUND", `Escalation '${options.escalationId}' was not found.`);
    const escalation = toEscalation(row);
    const consumptionEvents = database.prepare("SELECT work_item_id, used_at FROM escalation_uses WHERE escalation_id = ? ORDER BY id").all(escalation.id) as Array<Record<string, unknown>>;
    return {
      ...escalation,
      consumptionEvents: consumptionEvents.map((event) => ({ workItemId: String(event.work_item_id), usedAt: String(event.used_at) })),
    };
  } finally {
    database.close();
  }
}

function validateEscalationUse(escalation: Escalation, workItemId: string, at = Date.now()): void {
  if (escalation.payload.scope[0] !== workItemId.toLowerCase()) fail("ESCALATION_OUT_OF_SCOPE", "Escalation does not apply to this Work Item.");
  if (escalation.payload.expiresAt && Date.parse(escalation.payload.expiresAt) <= at) fail("ESCALATION_EXPIRED", "Escalation has expired.");
  if (escalation.payload.maxUses !== undefined && escalation.uses >= escalation.payload.maxUses) fail("ESCALATION_EXHAUSTED", "Escalation has no remaining uses.");
}

/** Validate one intended use without reserving, consuming, or auditing it. */
export function preflightEscalationUse(options: { rootDir?: string; escalationId: string; workItemId: string }): Escalation {
  const escalation = getEscalation(options);
  validateEscalationUse(escalation, options.workItemId);
  if (pendingEscalationUseOperations({ rootDir: options.rootDir, escalationId: escalation.id }).length > 0) {
    fail("ESCALATION_PENDING_RECOVERY", "Escalation has an unresolved use operation.");
  }
  return escalation;
}

function operationFromRow(row: Record<string, unknown>): EscalationUseOperation {
  const scope = JSON.parse(String(row.scope));
  if (!Array.isArray(scope) || scope.length !== 1 || typeof scope[0] !== "string") {
    fail("ESCALATION_USE_OPERATION_INVALID", "Escalation use operation has an invalid scope.");
  }
  return {
    id: String(row.id), sagaId: String(row.saga_id), escalationId: String(row.escalation_id),
    workItemId: String(row.work_item_id), scope: [scope[0]], reservationId: String(row.reservation_id),
    claimToken: String(row.claim_token), workFilePath: String(row.work_file_path),
    expectedWorkHash: String(row.expected_work_hash), desiredWorkHash: String(row.desired_work_hash),
    workMutationId: String(row.work_mutation_id), expectedWorkRevision: String(row.expected_work_revision),
    phase: String(row.phase) as EscalationUseOperation["phase"],
    ...(typeof row.effect_attempted_at === "string" ? { effectAttemptedAt: row.effect_attempted_at } : {}),
    ...(typeof row.effect_expires_at === "string" ? { effectExpiresAt: row.effect_expires_at } : {}),
    ...(typeof row.mutation_applied_at === "string" ? { mutationAppliedAt: row.mutation_applied_at } : {}),
  };
}

function assertNoPendingEscalationUseOperations(database: DatabaseSync, escalationId: string): void {
  if (database.prepare("SELECT 1 FROM escalation_use_operations WHERE escalation_id = ? AND phase IN ('reserved', 'mutation-intent', 'mutation-applied', 'disputed')").get(escalationId)) {
    fail("ESCALATION_PENDING_RECOVERY", "Escalation has an unresolved use operation.");
  }
}

/** Reserve and durably identify one Work mutation before its source effect. */
export function reserveEscalationUseOperation(options: Omit<EscalationUseOperation, "reservationId" | "scope" | "phase" | "effectAttemptedAt" | "effectExpiresAt" | "mutationAppliedAt"> & { rootDir?: string }): EscalationUseOperation {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare("SELECT * FROM escalations WHERE id = ?").get(options.escalationId) as Record<string, unknown> | undefined;
      if (!row) fail("ESCALATION_NOT_FOUND", `Escalation '${options.escalationId}' was not found.`);
      const escalation = toEscalation(row);
      validateEscalationUse(escalation, options.workItemId);
      assertNoPendingEscalationUseOperations(database, escalation.id);
      const reserved = Number((database.prepare("SELECT COUNT(*) AS count FROM escalation_reservations WHERE escalation_id = ?").get(escalation.id) as { count: number }).count);
      if (escalation.payload.maxUses !== undefined && escalation.uses + reserved >= escalation.payload.maxUses) fail("ESCALATION_EXHAUSTED", "Escalation has no remaining uses.");
      const reservationId = randomUUID();
      const now = new Date().toISOString();
      database.prepare("INSERT INTO escalation_reservations (id, escalation_id, work_item_id, reserved_at) VALUES (?, ?, ?, ?)")
        .run(reservationId, escalation.id, options.workItemId, now);
      database.prepare(`INSERT INTO escalation_use_operations (
        id, saga_id, escalation_id, work_item_id, scope, reservation_id, claim_token,
        work_file_path, expected_work_hash, desired_work_hash, work_mutation_id, expected_work_revision, phase, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`)
        .run(options.id, options.sagaId, escalation.id, options.workItemId, JSON.stringify(escalation.payload.scope), reservationId, options.claimToken,
          options.workFilePath, options.expectedWorkHash, options.desiredWorkHash, options.workMutationId, options.expectedWorkRevision, now, now);
      database.exec("COMMIT");
      return { ...options, escalationId: escalation.id, scope: escalation.payload.scope, reservationId, phase: "reserved" };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

/** List unresolved operations so a conflicting bounded use recovers first. */
export function pendingEscalationUseOperations(options: { rootDir?: string; escalationId: string }): EscalationUseOperation[] {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    return (database.prepare("SELECT * FROM escalation_use_operations WHERE escalation_id = ? AND phase IN ('reserved', 'mutation-intent', 'mutation-applied', 'disputed') ORDER BY created_at").all(options.escalationId) as Record<string, unknown>[])
      .map(operationFromRow);
  } finally {
    database.close();
  }
}

/** Confirm expiry immediately before the only source mutation may begin. */
export function beginEscalationUseOperationEffect(options: { rootDir?: string; operationId: string }): void {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare("SELECT * FROM escalation_use_operations WHERE id = ?").get(options.operationId) as Record<string, unknown> | undefined;
      if (!row) fail("ESCALATION_USE_OPERATION_NOT_FOUND", `Escalation use operation '${options.operationId}' was not found.`);
      if (row.phase !== "mutation-intent") fail("ESCALATION_USE_OPERATION_PHASE_INVALID", "Escalation use operation is not ready for its source effect.");
      const escalationRow = database.prepare("SELECT * FROM escalations WHERE id = ?").get(String(row.escalation_id)) as Record<string, unknown> | undefined;
      if (!escalationRow) fail("ESCALATION_NOT_FOUND", `Escalation '${String(row.escalation_id)}' was not found.`);
      if (!database.prepare("SELECT 1 FROM escalation_reservations WHERE id = ? AND escalation_id = ? AND work_item_id = ?").get(String(row.reservation_id), String(row.escalation_id), String(row.work_item_id))) {
        fail("ESCALATION_RESERVATION_INVALID", "Escalation reservation is no longer active.");
      }
      const escalation = toEscalation(escalationRow);
      validateEscalationUse(escalation, String(row.work_item_id));
      const now = new Date().toISOString();
      database.prepare("UPDATE escalation_use_operations SET effect_attempted_at = ?, effect_expires_at = ?, updated_at = ? WHERE id = ?").run(now, escalation.payload.expiresAt ?? null, now, options.operationId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

/** Reject recovery release when the reservation itself has expired. */
export function assertEscalationUseOperationRecoverable(options: { rootDir?: string; operationId: string }): void {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const database = open(rootDir);
  try {
    const operation = database.prepare("SELECT * FROM escalation_use_operations WHERE id = ?").get(options.operationId) as Record<string, unknown> | undefined;
    if (!operation) fail("ESCALATION_USE_OPERATION_NOT_FOUND", `Escalation use operation '${options.operationId}' was not found.`);
    const escalation = database.prepare("SELECT * FROM escalations WHERE id = ?").get(String(operation.escalation_id)) as Record<string, unknown> | undefined;
    if (!escalation) fail("ESCALATION_NOT_FOUND", `Escalation '${String(operation.escalation_id)}' was not found.`);
    validateEscalationUse(toEscalation(escalation), String(operation.work_item_id));
    assertActiveRuntimeClaimForTask({ rootDir, taskId: String(operation.work_item_id), claimToken: String(operation.claim_token) });
  } finally {
    database.close();
  }
}

/** Advance a durable phase before or after its corresponding source effect. */
export function updateEscalationUseOperationPhase(options: { rootDir?: string; operationId: string; phase: EscalationUseOperation["phase"] }): void {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    const now = new Date().toISOString();
    const result = database.prepare("UPDATE escalation_use_operations SET phase = ?, mutation_applied_at = CASE WHEN ? = 'mutation-applied' THEN COALESCE(mutation_applied_at, ?) ELSE mutation_applied_at END, updated_at = ? WHERE id = ?")
      .run(options.phase, options.phase, now, now, options.operationId);
    if (Number(result.changes) !== 1) fail("ESCALATION_USE_OPERATION_NOT_FOUND", `Escalation use operation '${options.operationId}' was not found.`);
  } finally {
    database.close();
  }
}

/** Release only a source mutation proven absent; time alone never releases it. */
export function releaseEscalationUseOperation(options: { rootDir?: string; operationId: string }): void {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const operation = database.prepare("SELECT * FROM escalation_use_operations WHERE id = ?").get(options.operationId) as Record<string, unknown> | undefined;
      if (!operation) fail("ESCALATION_USE_OPERATION_NOT_FOUND", `Escalation use operation '${options.operationId}' was not found.`);
      if (database.prepare("SELECT 1 FROM escalation_uses WHERE operation_id = ?").get(options.operationId)) fail("ESCALATION_USE_RELEASE_CONFLICT", "A consumed escalation use cannot be released.");
      database.prepare("DELETE FROM escalation_reservations WHERE id = ?").run(String(operation.reservation_id));
      database.prepare("UPDATE escalation_use_operations SET phase = 'released', updated_at = ? WHERE id = ?").run(new Date().toISOString(), options.operationId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

/** Finalize exactly one consumption/audit record for a proven Work mutation. */
export function finalizeEscalationUseOperation(options: { rootDir?: string; operationId: string }): Escalation {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const authority = new RuntimeClaimSqliteDataAdapter({ rootDir });
  let escalationId: string;
  authority.withStore((runtime) => runtime.withTransaction(() => {
    const database = runtime.database;
    const operation = database.prepare("SELECT * FROM escalation_use_operations WHERE id = ?").get(options.operationId) as Record<string, unknown> | undefined;
    if (!operation) fail("ESCALATION_USE_OPERATION_NOT_FOUND", `Escalation use operation '${options.operationId}' was not found.`);
    escalationId = String(operation.escalation_id);
    const workItemId = String(operation.work_item_id);
    const claimToken = String(operation.claim_token);
    if (!database.prepare("SELECT 1 FROM runtime_claims WHERE claim_token = ? AND target_type = 'task' AND target_id = ? AND state = 'active'").get(claimToken, workItemId)) {
      fail("ESCALATION_USE_OPERATION_AUTHORITY_INVALID", "Escalation use operation no longer has its exact active Work claim.");
    }
    const alreadyUsed = database.prepare("SELECT 1 FROM escalation_uses WHERE operation_id = ?").get(options.operationId);
    if (!alreadyUsed) {
      const escalationRow = database.prepare("SELECT * FROM escalations WHERE id = ?").get(escalationId) as Record<string, unknown> | undefined;
      if (!escalationRow) fail("ESCALATION_NOT_FOUND", `Escalation '${escalationId}' was not found.`);
      if (!database.prepare("SELECT 1 FROM escalation_reservations WHERE id = ? AND escalation_id = ? AND work_item_id = ?")
        .get(String(operation.reservation_id), escalationId, workItemId)) fail("ESCALATION_RESERVATION_INVALID", "Escalation reservation is no longer active.");
      if (typeof operation.effect_attempted_at !== "string" || typeof operation.mutation_applied_at !== "string") {
        fail("ESCALATION_USE_OPERATION_EFFECT_UNPROVEN", "Escalation use operation has no durable valid source-effect proof.");
      }
      const escalation = toEscalation(escalationRow);
      if (escalation.payload.scope[0] !== workItemId.toLowerCase()) fail("ESCALATION_OUT_OF_SCOPE", "Escalation does not apply to this Work Item.");
      // An expired finalization is allowed only for the source effect durably begun before its persisted expiry.
      const finalizationExpired = escalation.payload.expiresAt !== undefined && Date.parse(escalation.payload.expiresAt) <= Date.now();
      const effectExpiry = typeof operation.effect_expires_at === "string" ? Date.parse(operation.effect_expires_at) : undefined;
      if ((finalizationExpired && effectExpiry === undefined) || (effectExpiry !== undefined && effectExpiry <= Date.parse(String(operation.effect_attempted_at)))) {
        fail("ESCALATION_EXPIRED", "Escalation expired before its source effect began.");
      }
      if (escalation.payload.maxUses !== undefined && escalation.uses >= escalation.payload.maxUses) fail("ESCALATION_EXHAUSTED", "Escalation has no remaining uses.");
      database.prepare("UPDATE escalations SET uses = uses + 1 WHERE id = ?").run(escalationId);
      database.prepare("INSERT INTO escalation_uses (escalation_id, work_item_id, used_at, operation_id) VALUES (?, ?, ?, ?)")
        .run(escalationId, workItemId, new Date().toISOString(), options.operationId);
    }
    database.prepare("DELETE FROM escalation_reservations WHERE id = ?").run(String(operation.reservation_id));
    database.prepare("UPDATE escalation_use_operations SET phase = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), options.operationId);
  }));
  return getEscalation({ rootDir, escalationId: escalationId! });
}

/** Persist an unresolved state; its retained reservation blocks future uses. */
export function disputeEscalationUseOperation(options: { rootDir?: string; operationId: string }): void {
  updateEscalationUseOperationPhase({ ...options, phase: "disputed" });
}

/** A bounded reservation bridges the Work mutation and use finalization. */
interface EscalationReservation {
  readonly id: string;
  readonly escalation: Escalation;
}

function reserveEscalationUse(options: { rootDir?: string; escalationId: string; workItemId: string }): EscalationReservation {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare("SELECT * FROM escalations WHERE id = ?").get(options.escalationId) as Record<string, unknown> | undefined;
      if (!row) fail("ESCALATION_NOT_FOUND", `Escalation '${options.escalationId}' was not found.`);
      const escalation = toEscalation(row);
      validateEscalationUse(escalation, options.workItemId);
      assertNoPendingEscalationUseOperations(database, escalation.id);
      const reserved = Number((database.prepare("SELECT COUNT(*) AS count FROM escalation_reservations WHERE escalation_id = ?").get(escalation.id) as { count: number }).count);
      if (escalation.payload.maxUses !== undefined && escalation.uses + reserved >= escalation.payload.maxUses) fail("ESCALATION_EXHAUSTED", "Escalation has no remaining uses.");
      const id = randomUUID();
      database.prepare("INSERT INTO escalation_reservations (id, escalation_id, work_item_id, reserved_at) VALUES (?, ?, ?, ?)").run(id, escalation.id, options.workItemId, new Date().toISOString());
      database.exec("COMMIT");
      return { id, escalation };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

function releaseEscalationReservation(rootDir: string | undefined, reservationId: string): void {
  const database = open(path.resolve(rootDir ?? process.cwd()));
  try {
    database.prepare("DELETE FROM escalation_reservations WHERE id = ?").run(reservationId);
  } finally {
    database.close();
  }
}

function finalizeEscalationReservation(options: { rootDir?: string; workItemId: string; reservation: EscalationReservation }): Escalation {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const reservation = database.prepare("SELECT escalation_id, work_item_id FROM escalation_reservations WHERE id = ?").get(options.reservation.id) as Record<string, unknown> | undefined;
      if (!reservation || reservation.escalation_id !== options.reservation.escalation.id || reservation.work_item_id !== options.workItemId) fail("ESCALATION_RESERVATION_INVALID", "Escalation reservation is no longer active.");
      const row = database.prepare("SELECT * FROM escalations WHERE id = ?").get(options.reservation.escalation.id) as Record<string, unknown> | undefined;
      if (!row) fail("ESCALATION_NOT_FOUND", `Escalation '${options.reservation.escalation.id}' was not found.`);
      const escalation = toEscalation(row);
      validateEscalationUse(escalation, options.workItemId);
      const usedAt = new Date().toISOString();
      database.prepare("UPDATE escalations SET uses = uses + 1 WHERE id = ?").run(escalation.id);
      database.prepare("INSERT INTO escalation_uses (escalation_id, work_item_id, used_at) VALUES (?, ?, ?)").run(escalation.id, options.workItemId, usedAt);
      database.prepare("DELETE FROM escalation_reservations WHERE id = ?").run(options.reservation.id);
      database.exec("COMMIT");
      return { ...escalation, uses: escalation.uses + 1 };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

export async function applyEscalationUse<T>(options: {
  readonly rootDir?: string;
  readonly escalationId: string;
  readonly workItemId: string;
  readonly apply: () => Promise<EscalationApplication<T>>;
}): Promise<{ readonly escalation: Escalation; readonly result: T }> {
  const reservation = reserveEscalationUse(options);
  let application: EscalationApplication<T> | undefined;
  try {
    application = await options.apply();
    return {
      escalation: finalizeEscalationReservation({ ...options, reservation }),
      result: application.result,
    };
  } catch (error) {
    try {
      releaseEscalationReservation(options.rootDir, reservation.id);
    } finally {
      if (application) await application.compensate();
    }
    throw error;
  }
}

export function consumeEscalation(options: { rootDir?: string; escalationId: string; workItemId: string }): Escalation {
  const database = open(path.resolve(options.rootDir ?? process.cwd()));
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare("SELECT * FROM escalations WHERE id = ?").get(options.escalationId) as Record<string, unknown> | undefined;
      if (!row) fail("ESCALATION_NOT_FOUND", `Escalation '${options.escalationId}' was not found.`);
      const escalation = toEscalation(row);
      validateEscalationUse(escalation, options.workItemId);
      assertNoPendingEscalationUseOperations(database, escalation.id);
      const reserved = Number((database.prepare("SELECT COUNT(*) AS count FROM escalation_reservations WHERE escalation_id = ?").get(escalation.id) as { count: number }).count);
      if (escalation.payload.maxUses !== undefined && escalation.uses + reserved >= escalation.payload.maxUses) fail("ESCALATION_EXHAUSTED", "Escalation has no remaining uses.");
      const usedAt = new Date().toISOString();
      database.prepare("UPDATE escalations SET uses = uses + 1 WHERE id = ?").run(escalation.id);
      database.prepare("INSERT INTO escalation_uses (escalation_id, work_item_id, used_at) VALUES (?, ?, ?)").run(escalation.id, options.workItemId, usedAt);
      database.exec("COMMIT");
      return { ...escalation, uses: escalation.uses + 1 };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}
