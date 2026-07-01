import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRuntimeClaimToken,
  createRuntimeLockIdentity,
  openRuntimeSqliteStore,
  getRuntimeClaimDefaultTtlMilliseconds,
  RUNTIME_SCHEMA_VERSION,
  type RuntimeClaimAcquisitionSeed,
  type RuntimeClaim,
  type RuntimeClaimRenewalResult,
  type RuntimeExecutionLogEntry,
  type RuntimeInitialClaimAcquisitionResult,
  type RuntimeScopeLockAcquisitionRequest,
  type RuntimeLock,
} from "../lib/runtime/sqlite-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

async function mkRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-runtime-"));
  tempDirs.push(root);
  return root;
}

async function initGitRepo(root: string): Promise<void> {
  execFileSync("git", ["init", "--initial-branch", "main"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "agent@example.com"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Agent"], {
    cwd: root,
    stdio: "ignore",
  });
}

function makeClaim(overrides: Partial<RuntimeClaim> = {}): RuntimeClaim {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    claim_token: "claim_01jz4v5c6d7e8f9g0h1j2k3l4m",
    target_type: "task",
    target_id: "wi-60362",
    holder: "sandcastle:runtime-test",
    created_at: "2026-06-20T01:14:36.020Z",
    expires_at: "2026-06-20T05:14:36.020Z",
    metadata: {
      branch: "sandcastle/issue-60362",
      nested: { z: 2, a: 1 },
    },
    ...overrides,
  };
}

function makeClaimSeed(
  overrides: Partial<RuntimeClaimAcquisitionSeed> = {},
): RuntimeClaimAcquisitionSeed {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    target_type: "task",
    target_id: "wi-60362",
    holder: "sandcastle:runtime-test",
    created_at: "2026-06-20T01:14:36.020Z",
    expires_at: "2026-06-20T05:14:36.020Z",
    metadata: {
      branch: "sandcastle/issue-60362",
      nested: { z: 2, a: 1 },
    },
    entropy: "entropy-default",
    ...overrides,
  };
}

function makeExecutionLogEntry(
  overrides: Partial<RuntimeExecutionLogEntry> = {},
): RuntimeExecutionLogEntry {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    claim_token: "claim_01jz4v5c6d7e8f9g0h1j2k3l4m",
    target_type: "task",
    target_id: "wi-60362",
    created_at: "2026-06-20T01:14:41.020Z",
    state: "running",
    reason: "started",
    detail: {
      message: "Runtime claim acquired.",
      code: "x-runtime-started",
    },
    ...overrides,
  };
}

function makeLockRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    key: "6607988ebde1ab1bec92ae9ac9115738611f8f040c3ccdf227b4f178309904c1",
    path: "docs/runtime-entity-schemas.md",
    claim_token: "claim_01jz4v5c6d7e8f9g0h1j2k3l4m",
    target_type: "document",
    target_id: "docs/runtime-entity-schemas.md",
    created_at: "2026-06-20T01:14:40.020Z",
    metadata: {
      reason: "authoring",
    },
    ...overrides,
  };
}

function makeLock(
  root: string,
  overrides: Partial<RuntimeLock> = {},
): RuntimeLock {
  const path = overrides.path ?? "docs/runtime-entity-schemas.md";
  const identity = createRuntimeLockIdentity(path, { rootDir: root, cwd: root });
  return {
    schema_version: RUNTIME_SCHEMA_VERSION,
    key: identity.key,
    path: identity.path,
    claim_token: "claim_01jz4v5c6d7e8f9g0h1j2k3l4m",
    target_type: "task",
    target_id: "wi-60362",
    created_at: "2026-06-20T01:14:40.020Z",
    metadata: {
      reason: "authoring",
    },
    ...overrides,
  };
}

function snapshotSchema(store: ReturnType<typeof openRuntimeSqliteStore>) {
  return store.database
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as Array<{ type: string; name: string; sql: string | null }>;
}

function expectClaimAcquired(
  result: RuntimeInitialClaimAcquisitionResult,
) {
  if (result.outcome !== "acquired") {
    throw new Error("Expected the claim to be acquired.");
  }
  return result;
}

function expectClaimRenewed(result: RuntimeClaimRenewalResult) {
  if (result.outcome !== "renewed") {
    throw new Error("Expected the claim to be renewed.");
  }
  return result;
}

function expectClaimRenewalConflict(
  result: RuntimeClaimRenewalResult,
) {
  if (result.outcome !== "conflict") {
    throw new Error("Expected renewal to conflict.");
  }
  return result;
}

function acquireClaimWithScopeLocks(
  store: ReturnType<typeof openRuntimeSqliteStore>,
  options: {
    targetId: string;
    entropy: string;
    scopeLocks: RuntimeScopeLockAcquisitionRequest[];
  },
) {
  const acquisition = store.acquireRuntimeClaim(
    makeClaimSeed({
      target_id: options.targetId,
      entropy: options.entropy,
      expires_at: "2099-06-20T01:20:36.020Z",
      created_at: "2099-06-20T01:14:36.020Z",
    }),
  );
  const claim = expectClaimAcquired(acquisition);

  expect(
    store.acquireRuntimeScopeLocks(claim.claimToken, options.scopeLocks),
  ).toMatchObject({
    outcome: "acquired",
    claimToken: claim.claimToken,
  });

  return claim;
}

function setClaimLeaseWindow(
  store: ReturnType<typeof openRuntimeSqliteStore>,
  claimToken: string,
) {
  store.database
    .prepare(
      "UPDATE claims SET last_seen_at = ?, expires_at = ? WHERE claim_token = ?",
    )
    .run(
      "2099-06-20T01:15:36.020Z",
      "2099-06-20T01:20:36.020Z",
      claimToken,
    );
}

function insertActiveScopeLock(
  store: ReturnType<typeof openRuntimeSqliteStore>,
  options: {
    claimToken: string;
    scopeRef: string;
    lockMode: "read" | "write" | "execute";
    policyName: "ReadLockPolicy" | "WriteLockPolicy" | "ExecuteLockPolicy";
    acquiredAt: string;
    updatedAt?: string;
  },
) {
  store.insertScopeLock({
    schema_version: RUNTIME_SCHEMA_VERSION,
    claim_token: options.claimToken,
    scope_ref: options.scopeRef,
    lock_mode: options.lockMode,
    policy_name: options.policyName,
    acquired_at: options.acquiredAt,
    updated_at: options.updatedAt ?? options.acquiredAt,
    lifecycle_state: "active",
  });
}

describe("runtime sqlite store", () => {
  it("derives claim tokens from canonical static claim records", () => {
    const seedA = makeClaimSeed({
      entropy: "entropy-123",
      metadata: { z: 2, a: 1 },
    });
    const seedB = makeClaimSeed({
      entropy: "entropy-123",
      metadata: { a: 1, z: 2 },
    });

    expect(createRuntimeClaimToken(seedA)).toBe(
      createRuntimeClaimToken(seedB),
    );
    expect(createRuntimeClaimToken(seedA)).toHaveLength(64);
  });

  it("initializes the runtime database under the configured runtime path", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      expect(store.databasePath).toBe(
        path.join(root, ".doc-vader", "runtime", "runtime.sqlite"),
      );

      const firstSchema = snapshotSchema(store);
      const firstMigrationCount = store.database
        .prepare("SELECT count(*) AS count FROM runtime_migrations")
        .get() as { count: number };

      const claimColumns = store.database
        .prepare("PRAGMA table_info(claims)")
        .all() as Array<{ name: string }>;
      const lockColumns = store.database
        .prepare("PRAGMA table_info(locks)")
        .all() as Array<{ name: string }>;
      const executionLogColumns = store.database
        .prepare("PRAGMA table_info(execution_log)")
        .all() as Array<{ name: string }>;

      expect(firstMigrationCount.count).toBe(3);
      expect(claimColumns.map((column) => column.name)).toEqual([
        "schema_version",
        "claim_token",
        "target_type",
        "target_id",
        "holder",
        "expires_at",
        "created_at",
        "updated_at",
        "metadata",
        "last_seen_at",
      ]);
      expect(claimColumns.map((column) => column.name)).not.toContain(
        "execution_id",
      );
      expect(claimColumns.map((column) => column.name)).not.toContain("state");
      expect(lockColumns.map((column) => column.name)).toEqual([
        "schema_version",
        "key",
        "path",
        "claim_token",
        "target_type",
        "target_id",
        "created_at",
        "metadata",
      ]);
      expect(executionLogColumns.map((column) => column.name)).toEqual([
        "id",
        "schema_version",
        "claim_token",
        "target_type",
        "target_id",
        "state",
        "reason",
        "created_at",
        "payload",
      ]);
      expect(
        store.database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'runtime_claims'",
        ).get(),
      ).toBeTruthy();

      store.close();
      let reopened: ReturnType<typeof openRuntimeSqliteStore> | undefined;
      try {
        reopened = openRuntimeSqliteStore({ rootDir: root });
        expect(snapshotSchema(reopened)).toEqual(firstSchema);
        expect(
          reopened.database
            .prepare("SELECT count(*) AS count FROM runtime_migrations")
            .get(),
        ).toMatchObject({ count: 3 });
      } finally {
        reopened?.close();
      }
    } finally {
      if (store.database) {
        try {
          store.close();
        } catch {
          // Ignore double-close from the reopened validation path.
        }
      }
    }
  });

  it("derives claim state centrally from expires_at", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim(
        makeClaim({
          claim_token: "claim-active",
          target_id: "wi-active",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      store.insertClaim(
        makeClaim({
          claim_token: "claim-expired",
          target_id: "wi-expired",
          expires_at: "2026-06-20T00:14:36.020Z",
        }),
      );

      expect(store.getClaimByToken("claim-active")).toMatchObject({
        state: "active",
        target_id: "wi-active",
      });
      expect(store.getClaimByToken("claim-expired")).toMatchObject({
        state: "expired",
        target_id: "wi-expired",
      });
    } finally {
      store.close();
    }
  });

  it("tracks claim context freshness without extending the lease unless renewed", { timeout: 15_000 }, async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.insertClaim(
        makeClaim({
          claim_token: "claim-freshness",
          target_id: "wi-freshness",
          expires_at: "2099-06-23T05:14:36.020Z",
          created_at: "2026-06-20T01:14:36.020Z",
        }),
      );
      store.database
        .prepare(
          "UPDATE claims SET last_seen_at = ?, expires_at = ? WHERE claim_token = ?",
        )
        .run(
          "2026-06-20T01:15:36.020Z",
          "2026-06-20T05:14:36.020Z",
          claim.claim_token,
        );

      const touched = store.touchClaimContext(claim.claim_token, {
        now: new Date("2026-06-20T01:16:36.020Z"),
      });
      expect(touched).toMatchObject({
        claim_token: claim.claim_token,
        last_seen_at: "2026-06-20T01:16:36.020Z",
        expires_at: "2026-06-20T05:14:36.020Z",
      });

      const renewed = store.touchClaimContext(claim.claim_token, {
        now: new Date("2026-06-20T01:17:36.020Z"),
        renew: true,
        ttlMilliseconds: 30 * 60_000,
      });
      expect(renewed).toMatchObject({
        claim_token: claim.claim_token,
        last_seen_at: "2026-06-20T01:17:36.020Z",
        expires_at: "2026-06-20T01:47:36.020Z",
      });
    } finally {
      store.close();
    }
  });

  it("renews active claims when explicit claim-context mutations acquire locks", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.insertClaim(
        makeClaim({
          claim_token: "claim-renew-locks",
          target_id: "wi-renew-locks",
          expires_at: "2099-06-20T05:14:36.020Z",
          created_at: "2099-06-20T01:14:36.020Z",
        }),
      );
      store.database
        .prepare(
          "UPDATE claims SET last_seen_at = ?, expires_at = ? WHERE claim_token = ?",
        )
        .run(
          "2099-06-20T01:15:36.020Z",
          "2099-06-20T01:20:36.020Z",
          claim.claim_token,
        );

      const result = store.acquireRuntimeLocks(claim.claim_token, [
        "backlog/renew-locks.md",
      ]);
      expect(result).toMatchObject({
        outcome: "acquired",
        claimToken: claim.claim_token,
      });
      expect(store.getClaimByToken(claim.claim_token)).toMatchObject({
        claim_token: claim.claim_token,
        last_seen_at: expect.any(String),
      });
      expect(store.getClaimByToken(claim.claim_token)?.expires_at).not.toBe(
        "2099-06-20T01:20:36.020Z",
      );
    } finally {
      store.close();
    }
  });

  it("renews immutable claims only when every associated scope remains available", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquiredClaim = acquireClaimWithScopeLocks(store, {
        targetId: "wi-renew-all-scopes",
        entropy: "entropy-renew-all-scopes",
        scopeLocks: [
          { scopeRef: "wi-renew-read-scope", lockMode: "read" },
          { scopeRef: "wi-renew-write-scope", lockMode: "write" },
          { scopeRef: "wi-renew-execute-scope", lockMode: "execute" },
        ],
      });
      setClaimLeaseWindow(store, acquiredClaim.claimToken);

      const renewed = expectClaimRenewed(
        store.renewRuntimeClaim(acquiredClaim.claimToken, {
          now: new Date("2099-06-20T01:17:36.020Z"),
          ttlMilliseconds: 30 * 60_000,
        }),
      );

      expect(renewed).toMatchObject({
        outcome: "renewed",
        claimToken: acquiredClaim.claimToken,
        claim: {
          claim_token: acquiredClaim.claimToken,
          last_seen_at: "2099-06-20T01:17:36.020Z",
          expires_at: "2099-06-20T01:47:36.020Z",
        },
      });
      expect(renewed.claim.claim_token).toBe(acquiredClaim.claimToken);
      expect(
        store.listScopeLocksByClaimToken(acquiredClaim.claimToken).filter(
          (lock) => lock.lifecycle_state === "active",
        ),
      ).toHaveLength(4);
    } finally {
      store.close();
    }
  });

  it("blocks renewal when an execute scope becomes unavailable", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquiredClaim = acquireClaimWithScopeLocks(store, {
        targetId: "wi-renew-blocked",
        entropy: "entropy-renew-blocked",
        scopeLocks: [
          { scopeRef: "wi-renew-execute-only", lockMode: "execute" },
        ],
      });

      const foreignClaim = store.insertClaim(
        makeClaim({
          claim_token: "claim-foreign-renew-execute",
          target_id: "wi-foreign-renew-execute",
          expires_at: "2099-06-21T01:20:36.020Z",
          created_at: "2099-06-20T01:16:36.020Z",
        }),
      );
      insertActiveScopeLock(store, {
        claimToken: foreignClaim.claim_token,
        scopeRef: "wi:renew-execute-only",
        lockMode: "write",
        policyName: "WriteLockPolicy",
        acquiredAt: "2099-06-20T01:16:36.020Z",
      });

      const before = store.getClaimByToken(acquiredClaim.claimToken);
      const renewed = expectClaimRenewalConflict(
        store.renewRuntimeClaim(acquiredClaim.claimToken, {
          now: new Date("2099-06-20T01:17:36.020Z"),
          ttlMilliseconds: 30 * 60_000,
        }),
      );

      expect(renewed).toMatchObject({
        outcome: "conflict",
        claimToken: acquiredClaim.claimToken,
        conflicts: [
          {
            scope_ref: "wi:renew-execute-only",
            requested_mode: "execute",
            conflicting_modes: ["write"],
            policy_name: "ExecuteLockPolicy",
            owner: {
              claim_token: foreignClaim.claim_token,
              target_id: foreignClaim.target_id,
            },
          },
        ],
      });
      expect(store.getClaimByToken(acquiredClaim.claimToken)?.expires_at).toBe(
        before?.expires_at,
      );
      expect(
        store.getScopeLockByClaimTokenAndScopeRef(
          acquiredClaim.claimToken,
          "wi:renew-execute-only",
          "execute",
        )?.lifecycle_state,
      ).toBe("active");
    } finally {
      store.close();
    }
  });

  it("reports only the conflicting associated scopes during mixed-scope renewal failure", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquiredClaim = acquireClaimWithScopeLocks(store, {
        targetId: "wi-renew-mixed",
        entropy: "entropy-renew-mixed",
        scopeLocks: [
          { scopeRef: "wi-renew-mixed-read", lockMode: "read" },
          { scopeRef: "wi-renew-mixed-write", lockMode: "write" },
          { scopeRef: "wi-renew-mixed-execute", lockMode: "execute" },
        ],
      });
      const before = store.getClaimByToken(acquiredClaim.claimToken);

      const foreignRead = store.insertClaim(
        makeClaim({
          claim_token: "claim-foreign-renew-read",
          target_id: "wi-foreign-renew-read",
          expires_at: "2099-06-21T01:20:36.020Z",
          created_at: "2099-06-20T01:16:36.020Z",
        }),
      );
      insertActiveScopeLock(store, {
        claimToken: foreignRead.claim_token,
        scopeRef: "wi:renew-mixed-read",
        lockMode: "write",
        policyName: "WriteLockPolicy",
        acquiredAt: "2099-06-20T01:16:36.020Z",
      });
      const foreignWrite = store.insertClaim(
        makeClaim({
          claim_token: "claim-foreign-renew-write",
          target_id: "wi-foreign-renew-write",
          expires_at: "2099-06-21T01:21:36.020Z",
          created_at: "2099-06-20T01:16:37.020Z",
        }),
      );
      insertActiveScopeLock(store, {
        claimToken: foreignWrite.claim_token,
        scopeRef: "wi:renew-mixed-write",
        lockMode: "read",
        policyName: "ReadLockPolicy",
        acquiredAt: "2099-06-20T01:16:37.020Z",
      });

      const renewed = expectClaimRenewalConflict(
        store.renewRuntimeClaim(acquiredClaim.claimToken, {
          now: new Date("2099-06-20T01:17:36.020Z"),
          ttlMilliseconds: 30 * 60_000,
        }),
      );

      expect(renewed).toMatchObject({
        outcome: "conflict",
        claimToken: acquiredClaim.claimToken,
        conflicts: [
          {
            scope_ref: "wi:renew-mixed-read",
            requested_mode: "read",
            conflicting_modes: ["write"],
            policy_name: "ReadLockPolicy",
          },
          {
            scope_ref: "wi:renew-mixed-write",
            requested_mode: "write",
            conflicting_modes: ["read"],
            policy_name: "WriteLockPolicy",
          },
        ],
      });
      expect(renewed.conflicts).toHaveLength(2);
      expect(
        renewed.conflicts.some(
          (conflict) => conflict.scope_ref === "wi:renew-mixed-execute",
        ),
      ).toBe(false);
      expect(store.getClaimByToken(acquiredClaim.claimToken)?.expires_at).toBe(
        before?.expires_at,
      );
    } finally {
      store.close();
    }
  });

  it("derives the default runtime claim ttl from the idle timeout plus grace", () => {
    expect(
      getRuntimeClaimDefaultTtlMilliseconds({
        SANDCASTLE_IDLE_TIMEOUT_SECONDS: "600",
      } as NodeJS.ProcessEnv),
    ).toBe(900_000);
    expect(getRuntimeClaimDefaultTtlMilliseconds({} as NodeJS.ProcessEnv)).toBe(
      240 * 60_000,
    );
  });

  it("blocks lock acquisition for expired claims before cleanup", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.insertClaim(
        makeClaim({
          claim_token: "claim-expired-locks",
          target_id: "wi-expired-locks",
          expires_at: "2026-06-20T00:14:36.020Z",
        }),
      );

      const result = store.acquireRuntimeLocks(claim.claim_token, [
        "backlog/expired-lock.md",
      ]);

      expect(result).toMatchObject({
        outcome: "conflict",
        claimToken: claim.claim_token,
        conflicts: [
          {
            path: "backlog/expired-lock.md",
            owner: {
              claim_token: claim.claim_token,
              state: "expired",
              expires_at: "2026-06-20T00:14:36.020Z",
            },
          },
        ],
      });
      expect(store.listLocks()).toHaveLength(0);
      expect(store.listExecutionLogEntries()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("enforces claim uniqueness on target identity", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim(makeClaim({ target_id: "wi-one" }));
      expect(() =>
        store.insertClaim(
          makeClaim({
            claim_token: "claim-second",
            target_id: "wi-one",
          }),
        ),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      store.close();
    }
  });

  it("enforces lock uniqueness for both key and path", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim(
        makeClaim({
          claim_token: "claim-locks",
          target_type: "document",
          target_id: "docs/runtime-entity-schemas.md",
        }),
      );

      const insertRawLock = (row: Record<string, unknown>) => {
        store.database
          .prepare(
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
          )
          .run(
            row.schema_version,
            row.key,
            row.path,
            row.claim_token,
            row.target_type,
            row.target_id,
            row.created_at,
            JSON.stringify(row.metadata),
          );
      };

      insertRawLock(makeLockRow({ claim_token: "claim-locks" }));
      expect(() =>
        insertRawLock(
          makeLockRow({
            claim_token: "claim-locks",
            path: "docs/runtime-entity-schemas-copy.md",
          }),
        ),
      ).toThrow(/UNIQUE constraint failed/);
      expect(() =>
        insertRawLock(
          makeLockRow({
            claim_token: "claim-locks",
            key: "6607988ebde1ab1bec92ae9ac9115738611f8f040c3ccdf227b4f178309904c2",
            path: "docs/runtime-entity-schemas.md",
          }),
        ),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      store.close();
    }
  });

  it("acquires claims, initial locks, and the running log entry atomically", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const result = store.acquireRuntimeClaim(
        makeClaimSeed({ expires_at: "2099-06-23T05:14:36.020Z" }),
        {
          initialLockPaths: ["backlog/runtime/entity.md"],
        },
      );

      expect(result).toMatchObject({
        outcome: "acquired",
        claim: {
          claim_token: result.claimToken,
          target_id: "wi-60362",
        },
        locks: [
          {
            path: "backlog/runtime/entity.md",
            claim_token: result.claimToken,
          },
        ],
        executionLogEntry: {
          claim_token: result.claimToken,
          state: "running",
          reason: "started",
        },
      });
      expect(store.listClaims()).toHaveLength(1);
      expect(store.listLocks()).toHaveLength(1);
      expect(store.listExecutionLogEntries()).toHaveLength(1);
      expect(store.listExecutionLogEntries()[0]).toMatchObject({
        claim_token: result.claimToken,
        state: "running",
        reason: "started",
      });
    } finally {
      store.close();
    }
  });

  it("allows claim creation with zero initial locks", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const result = store.acquireRuntimeClaim(
        makeClaimSeed({
          entropy: "entropy-zero-locks",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );

      expect(result.outcome).toBe("acquired");
      if (result.outcome === "acquired") {
        expect(result.locks).toHaveLength(0);
        expect(store.listLocks()).toHaveLength(0);
      }
    } finally {
      store.close();
    }
  });

  it("allows flat scope locks to coexist by compatibility policy", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const readClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-scope-read",
          entropy: "entropy-scope-read",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      const secondReadClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-scope-read-2",
          entropy: "entropy-scope-read-2",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      const executeClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-scope-execute",
          entropy: "entropy-scope-execute",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      const writeClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-scope-write",
          entropy: "entropy-scope-write",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );

      for (const claim of [
        readClaim,
        secondReadClaim,
        executeClaim,
        writeClaim,
      ]) {
        if (claim.outcome !== "acquired") {
          throw new Error("Expected the claim to be acquired.");
        }
      }

      const scopeRef = "wi-60385-scope";
      const firstRead = store.acquireRuntimeScopeLocks(readClaim.claimToken, [
        { scopeRef, lockMode: "read" },
      ]);
      const secondRead = store.acquireRuntimeScopeLocks(
        secondReadClaim.claimToken,
        [{ scopeRef, lockMode: "read" }],
      );
      const execute = store.acquireRuntimeScopeLocks(executeClaim.claimToken, [
        { scopeRef, lockMode: "execute" },
      ]);
      const write = store.acquireRuntimeScopeLocks(writeClaim.claimToken, [
        { scopeRef, lockMode: "write" },
      ]);

      expect(firstRead).toMatchObject({
        outcome: "acquired",
        claimToken: readClaim.claimToken,
        locks: [
          {
            scope_ref: "wi:60385-scope",
            lock_mode: "read",
            lifecycle_state: "active",
          },
        ],
      });
      expect(secondRead).toMatchObject({
        outcome: "acquired",
        claimToken: secondReadClaim.claimToken,
        locks: [
          {
            scope_ref: "wi:60385-scope",
            lock_mode: "read",
            lifecycle_state: "active",
          },
        ],
      });
      expect(execute).toMatchObject({
        outcome: "acquired",
        claimToken: executeClaim.claimToken,
        locks: [
          {
            scope_ref: "wi:60385-scope",
            lock_mode: "execute",
            lifecycle_state: "active",
          },
        ],
      });
      expect(write).toMatchObject({
        outcome: "conflict",
        claimToken: writeClaim.claimToken,
        conflicts: [
          expect.objectContaining({
            scope_ref: "wi:60385-scope",
            requested_mode: "write",
            conflicting_modes: expect.arrayContaining(["read", "execute"]),
            policy_name: "WriteLockPolicy",
          }),
        ],
      });
      expect(store.listScopeLocksByClaimToken(readClaim.claimToken)).toHaveLength(
        2,
      );
      expect(
        store.listScopeLocksByClaimToken(secondReadClaim.claimToken),
      ).toHaveLength(2);
      expect(store.listScopeLocksByClaimToken(executeClaim.claimToken)).toHaveLength(
        2,
      );
      expect(store.listScopeLocksByClaimToken(writeClaim.claimToken)).toHaveLength(
        1,
      );
      expect(store.listScopeLocks()).toHaveLength(7);
    } finally {
      store.close();
    }
  });

  it("reuses self-owned scope locks and canonicalizes requested scopes generically", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-scope-generic",
          entropy: "entropy-scope-generic",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      expect(claim.outcome).toBe("acquired");
      if (claim.outcome !== "acquired") {
        throw new Error("Expected claim acquisition.");
      }

      const first = store.acquireRuntimeScopeLocks(claim.claimToken, [
        { scopeRef: "record:scope-evidence", lockMode: "write" },
        { scopeRef: "record:scope-evidence", lockMode: "write" },
      ]);
      expect(first).toMatchObject({
        outcome: "acquired",
        locks: [
          {
            scope_ref: "record:scope-evidence",
            lock_mode: "write",
            lifecycle_state: "active",
          },
        ],
      });

      const second = store.acquireRuntimeScopeLocks(claim.claimToken, [
        { scopeRef: "record:scope-evidence", lockMode: "write" },
      ]);
      expect(second).toMatchObject({
        outcome: "acquired",
        locks: [
          {
            scope_ref: "record:scope-evidence",
            lock_mode: "write",
            lifecycle_state: "active",
          },
        ],
      });
      expect(
        store
          .listScopeLocksByClaimToken(claim.claimToken)
          .filter((lock) => lock.scope_ref === "record:scope-evidence"),
      ).toHaveLength(1);

      const removed = store.removeRuntimeScopeLocks(claim.claimToken, [
        "record:scope-evidence",
      ]);
      expect(removed).toMatchObject({
        outcome: "removed",
        removed: [
          {
            scope_ref: "record:scope-evidence",
            lock_mode: "write",
          },
        ],
      });
    } finally {
      store.close();
    }
  });

  it("halts initial acquisition on lock conflict without leaking live state", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim(
        makeClaim({
          claim_token: "claim-existing",
          target_id: "wi-existing",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: "claim-existing",
          target_id: "wi-existing",
          path: "backlog/shared.md",
        }),
      );

      const result = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-fresh",
          entropy: "entropy-conflict",
        }),
        { initialLockPaths: ["backlog/shared.md"] },
      );

      expect(result).toMatchObject({
        outcome: "conflict",
        conflicts: [
          {
            path: "backlog/shared.md",
            owner: {
              claim_token: "claim-existing",
              target_type: "task",
              target_id: "wi-existing",
              state: "active",
              expires_at: "2099-06-23T05:14:36.020Z",
            },
          },
        ],
        executionLogEntry: {
          claim_token: result.claimToken,
          state: "halted",
          reason: "conflict",
        },
      });
      expect(store.listClaims()).toHaveLength(1);
      expect(store.listClaims()[0]?.claim_token).toBe("claim-existing");
      expect(store.listLocks()).toHaveLength(1);
      expect(store.listExecutionLogEntries()).toHaveLength(1);
      expect(store.listExecutionLogEntries()[0]).toMatchObject({
        claim_token: result.claimToken,
        state: "halted",
        reason: "conflict",
      });
    } finally {
      store.close();
    }
  });

  it("returns structured diagnostics for lazy lock conflicts without halting the claim", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-primary",
          entropy: "entropy-primary",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const acquired = store.acquireRuntimeLocks(claim.claimToken, [
        "backlog/lazy.md",
      ]);
      expect(acquired).toMatchObject({
        outcome: "acquired",
        claimToken: claim.claimToken,
        locks: [
          {
            path: "backlog/lazy.md",
            claim_token: claim.claimToken,
          },
        ],
      });

      store.insertClaim(
        makeClaim({
          claim_token: "claim-foreign",
          target_id: "wi-foreign",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: "claim-foreign",
          target_id: "wi-foreign",
          path: "backlog/lazy-conflict.md",
        }),
      );

      const conflict = store.acquireRuntimeLocks(claim.claimToken, [
        "backlog/lazy-conflict.md",
      ]);
      expect(conflict).toMatchObject({
        outcome: "conflict",
        claimToken: claim.claimToken,
        conflicts: [
          {
            path: "backlog/lazy-conflict.md",
            owner: {
              claim_token: "claim-foreign",
              target_type: "task",
              target_id: "wi-foreign",
              state: "active",
              expires_at: "2099-06-23T05:14:36.020Z",
            },
          },
        ],
      });
      expect(store.listClaims()).toHaveLength(2);
      expect(store.listLocks()).toHaveLength(2);
      expect(store.listExecutionLogEntries()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("halts a running claim atomically and records dirty and unlocked paths", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquisition = store.acquireRuntimeClaim(
        makeClaimSeed({ expires_at: "2099-06-23T05:14:36.020Z" }),
        {
          initialLockPaths: ["backlog/owned.md", "backlog/dirty.md"],
        },
      );
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const halted = store.haltRuntimeExecution(acquisition.claimToken, {
        reason: "blocked",
        detail: {
          code: "x-runtime-claim-halted",
          message: "Stopped for recovery.",
          "x-dirty-paths": ["backlog/dirty.md"],
          "x-unlocked-paths": ["backlog/unlocked.md"],
        },
      });

      expect(halted).toMatchObject({
        claimToken: acquisition.claimToken,
        locksRemoved: 2,
        executionLogEntry: {
          claim_token: acquisition.claimToken,
          state: "halted",
          reason: "blocked",
        },
      });
      expect(JSON.parse(halted.executionLogEntry.payload)).toMatchObject({
        claim_token: acquisition.claimToken,
        state: "halted",
        reason: "blocked",
        detail: {
          code: "x-runtime-claim-halted",
          message: "Stopped for recovery.",
          "x-dirty-paths": ["backlog/dirty.md"],
          "x-unlocked-paths": ["backlog/unlocked.md"],
        },
      });
      expect(store.listClaims()).toHaveLength(0);
      expect(store.listLocks()).toHaveLength(0);
      expect(store.listExecutionLogEntries()).toHaveLength(2);
      expect(store.listExecutionLogEntries()[1]).toMatchObject({
        claim_token: acquisition.claimToken,
        state: "halted",
        reason: "blocked",
      });

      const reacquired = store.acquireRuntimeClaim(
        makeClaimSeed({
          entropy: "entropy-after-halt",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
        {
          initialLockPaths: ["backlog/owned.md"],
        },
      );
      expect(reacquired.outcome).toBe("acquired");
      if (reacquired.outcome !== "acquired") {
        throw new Error("Expected a fresh claim to be acquired after halt.");
      }
      expect(reacquired.claim.claim_token).not.toBe(acquisition.claimToken);
    } finally {
      store.close();
    }
  });

  it("prunes expired claims and owned locks without mutating execution history", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.insertClaim(
        makeClaim({
          claim_token: "claim-prune",
          target_id: "wi-prune",
          expires_at: "2026-06-20T00:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claim_token,
          target_id: "wi-prune",
          path: "backlog/prune.md",
        }),
      );

      const result = store.pruneRuntimeClaims(
        new Date("2026-06-21T00:00:00.000Z"),
      );

      expect(result).toMatchObject({
        outcome: "removed",
        removed: [
          {
            claimToken: claim.claim_token,
            locksRemoved: 1,
          },
        ],
      });
      expect(store.listClaims()).toHaveLength(0);
      expect(store.listLocks()).toHaveLength(0);
      expect(store.listExecutionLogEntries()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("prunes expired claims idempotently without touching foreign locks", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const expired = store.insertClaim(
        makeClaim({
          claim_token: "claim-prune-idempotent",
          target_id: "wi-prune-idempotent",
          expires_at: "2026-06-20T00:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: expired.claim_token,
          target_id: "wi-prune-idempotent",
          path: "backlog/prune-idempotent.md",
        }),
      );
      store.insertClaim(
        makeClaim({
          claim_token: "claim-foreign-lock",
          target_id: "wi-foreign-lock",
          expires_at: "2026-06-21T00:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: "claim-foreign-lock",
          target_id: "wi-foreign-lock",
          path: "backlog/foreign-lock.md",
        }),
      );

      const firstPass = store.pruneRuntimeClaims(
        new Date("2026-06-21T00:00:00.000Z"),
      );
      expect(firstPass).toMatchObject({
        outcome: "removed",
        removed: [
          {
            claimToken: expired.claim_token,
            locksRemoved: 1,
          },
        ],
      });
      expect(store.listClaims().map((claim) => claim.claim_token)).toEqual([
        "claim-foreign-lock",
      ]);
      expect(store.listLocks().map((lock) => lock.claim_token)).toEqual([
        "claim-foreign-lock",
      ]);
      expect(store.listExecutionLogEntries()).toHaveLength(0);

      const secondPass = store.pruneRuntimeClaims(
        new Date("2026-06-21T00:00:00.000Z"),
      );
      expect(secondPass).toMatchObject({
        outcome: "removed",
        removed: [],
      });
      expect(store.listClaims().map((claim) => claim.claim_token)).toEqual([
        "claim-foreign-lock",
      ]);
      expect(store.listLocks().map((lock) => lock.claim_token)).toEqual([
        "claim-foreign-lock",
      ]);
      expect(store.listExecutionLogEntries()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("fails closed when cleanup sees owned locks without a claim row", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.insertClaim(
        makeClaim({
          claim_token: "claim-inconsistent",
          target_id: "wi-inconsistent",
          expires_at: "2026-06-20T00:14:36.020Z",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claim_token,
          target_id: "wi-inconsistent",
          path: "backlog/inconsistent.md",
        }),
      );
      store.database.exec("PRAGMA foreign_keys = OFF");
      try {
        store.database
          .prepare("DELETE FROM claims WHERE claim_token = ?")
          .run(claim.claim_token);
      } finally {
        store.database.exec("PRAGMA foreign_keys = ON");
      }

      const result = store.removeRuntimeClaim(claim.claim_token);

      expect(result).toMatchObject({
        outcome: "conflict",
        conflicts: [
          {
            claim_token: claim.claim_token,
            reason: "inconsistent",
            message:
              "Claim cleanup found owned locks but no matching claim row.",
          },
        ],
      });
      expect(store.listClaims()).toHaveLength(0);
      expect(store.listLocks().map((lock) => lock.claim_token)).toEqual([
        claim.claim_token,
      ]);
      expect(store.listExecutionLogEntries()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("refuses to remove active running claims", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquisition = store.acquireRuntimeClaim(
        makeClaimSeed({ expires_at: "2099-06-23T05:14:36.020Z" }),
        {
          initialLockPaths: ["backlog/owned.md"],
        },
      );
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const result = store.removeRuntimeClaim(acquisition.claimToken);

      expect(result).toMatchObject({
        outcome: "conflict",
        conflicts: [
          {
            claim_token: acquisition.claimToken,
            reason: "active",
            state: "active",
          },
        ],
      });
      expect(store.listClaims()).toHaveLength(1);
      expect(store.listLocks()).toHaveLength(1);
      expect(store.listExecutionLogEntries()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rolls back halt writes when cleanup fails mid-transaction", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const acquisition = store.acquireRuntimeClaim(
        makeClaimSeed({ expires_at: "2099-06-23T05:14:36.020Z" }),
        {
          initialLockPaths: ["backlog/owned.md", "backlog/dirty.md"],
        },
      );
      if (acquisition.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const originalDeleteClaim = store.deleteClaim.bind(store);
      store.deleteClaim = (() => {
        throw new Error("simulated cleanup failure");
      }) as typeof store.deleteClaim;
      try {
        expect(() =>
          store.haltRuntimeExecution(acquisition.claimToken, {
            reason: "blocked",
            detail: {
              code: "x-runtime-claim-halted",
              message: "Stopped for recovery.",
            },
          }),
        ).toThrow("simulated cleanup failure");
      } finally {
        store.deleteClaim = originalDeleteClaim;
      }

      expect(store.listClaims()).toHaveLength(1);
      expect(store.listLocks()).toHaveLength(2);
      expect(store.listExecutionLogEntries()).toHaveLength(1);
      expect(store.listExecutionLogEntries()[0]).toMatchObject({
        claim_token: acquisition.claimToken,
        state: "running",
      });
    } finally {
      store.close();
    }
  });

  it("removes multiple locks atomically and reports modified-path conflicts", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "clean.md"), "clean\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "dirty.md"), "dirty\n", "utf8");
    execFileSync("git", ["add", "backlog/clean.md", "backlog/dirty.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base files"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(root, "backlog", "dirty.md"), "changed\n");

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-lock-rm",
          entropy: "entropy-lock-rm",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-lock-rm",
          path: "backlog/clean.md",
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-lock-rm",
          path: "backlog/dirty.md",
        }),
      );

      const conflict = store.removeRuntimeLocks(claim.claimToken, [
        "backlog/clean.md",
        "backlog/dirty.md",
      ]);
      expect(conflict).toMatchObject({
        outcome: "conflict",
        claimToken: claim.claimToken,
        conflicts: [
          expect.objectContaining({
            path: "backlog/dirty.md",
            reason: "modified",
            state: "modified",
          }),
        ],
      });
      expect(store.listLocksByClaimToken(claim.claimToken)).toHaveLength(2);

      const removed = store.removeRuntimeLocks(claim.claimToken, [
        "backlog/clean.md",
      ]);
      expect(removed).toMatchObject({
        outcome: "removed",
        claimToken: claim.claimToken,
        removed: [
          {
            path: "backlog/clean.md",
          },
        ],
      });
      expect(store.listLocksByClaimToken(claim.claimToken)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("reports normalized lock status with clean and modified states", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "clean.md"), "clean\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "dirty.md"), "dirty\n", "utf8");
    execFileSync("git", ["add", "backlog/clean.md", "backlog/dirty.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base files"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(root, "backlog", "dirty.md"), "changed\n");

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-lock-status",
          entropy: "entropy-lock-status",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const cleanIdentity = createRuntimeLockIdentity("backlog/clean.md", {
        rootDir: root,
        cwd: root,
      });
      const dirtyIdentity = createRuntimeLockIdentity("backlog/dirty.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-lock-status",
          path: cleanIdentity.path,
          key: cleanIdentity.key,
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-lock-status",
          path: dirtyIdentity.path,
          key: dirtyIdentity.key,
        }),
      );

      const status = store.getLockStatus(claim.claimToken);
      expect(status).toMatchObject({
        claimToken: claim.claimToken,
        state: "active",
        locks: [
          {
            path: "backlog/clean.md",
            key: cleanIdentity.key,
            state: "clean",
          },
          {
            path: "backlog/dirty.md",
            key: dirtyIdentity.key,
            state: "modified",
          },
        ],
      });
    } finally {
      store.close();
    }
  });

  it("audits changed files against the current claim lock set", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "locked.md"), "base\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "unlocked.md"), "base\n", "utf8");
    execFileSync("git", ["add", "backlog/locked.md", "backlog/unlocked.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base files"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", "feature/audit"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(root, "backlog", "locked.md"), "feature\n");
    await fs.appendFile(path.join(root, "backlog", "unlocked.md"), "feature\n");
    execFileSync("git", ["add", "backlog/locked.md", "backlog/unlocked.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: changed files"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-audit",
          entropy: "entropy-audit",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const lockedIdentity = createRuntimeLockIdentity("backlog/locked.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-audit",
          path: lockedIdentity.path,
          key: lockedIdentity.key,
        }),
      );

      const audit = store.auditChangedFiles(claim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit).toMatchObject({
        claimToken: claim.claimToken,
        mergeTargetRef: "main",
        fresh: true,
        mergeable: true,
        passed: false,
      });
      expect(audit.changedPaths).toEqual(
        expect.arrayContaining(["backlog/locked.md", "backlog/unlocked.md"]),
      );
      expect(audit.renameDiagnostics).toHaveLength(0);
      expect(audit.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "backlog/unlocked.md",
            expectedClaimToken: claim.claimToken,
            actualLockState: "missing",
            recommendedNextCommand: expect.stringContaining(
              "dv lock create --claim",
            ),
          }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("reports missing, foreign-owned, and expired lock diagnostics", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "owned.md"), "base\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "foreign.md"), "base\n", "utf8");
    await fs.writeFile(path.join(root, "backlog", "missing.md"), "base\n", "utf8");
    execFileSync("git", ["add", "backlog/owned.md", "backlog/foreign.md", "backlog/missing.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base audit files"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", "feature/audit-lock-states"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(root, "backlog", "owned.md"), "feature\n");
    await fs.appendFile(path.join(root, "backlog", "foreign.md"), "feature\n");
    await fs.appendFile(path.join(root, "backlog", "missing.md"), "feature\n");
    execFileSync("git", ["add", "backlog/owned.md", "backlog/foreign.md", "backlog/missing.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: branch changes"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const expiredClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-expired",
          created_at: "2026-06-15T12:00:00.000Z",
          expires_at: "2026-06-15T12:01:00.000Z",
          entropy: "entropy-expired",
        }),
      );
      if (expiredClaim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const foreignClaim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-foreign",
          created_at: "2026-06-15T12:00:00.000Z",
          expires_at: "2099-06-23T05:14:36.020Z",
          entropy: "entropy-foreign",
        }),
      );
      if (foreignClaim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const ownedIdentity = createRuntimeLockIdentity("backlog/owned.md", {
        rootDir: root,
        cwd: root,
      });
      const foreignIdentity = createRuntimeLockIdentity("backlog/foreign.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: expiredClaim.claimToken,
          target_id: "wi-expired",
          path: ownedIdentity.path,
          key: ownedIdentity.key,
        }),
      );
      store.insertLock(
        makeLock(root, {
          claim_token: foreignClaim.claimToken,
          target_id: "wi-foreign",
          path: foreignIdentity.path,
          key: foreignIdentity.key,
        }),
      );

      const audit = store.auditChangedFiles(expiredClaim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit.passed).toBe(false);
      expect(audit.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "backlog/owned.md",
            actualLockState: "expired",
          }),
          expect.objectContaining({
            path: "backlog/foreign.md",
            actualLockState: "foreign-owned",
          }),
          expect.objectContaining({
            path: "backlog/missing.md",
            actualLockState: "missing",
          }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("rejects git-detected renames during changed-file audit", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(path.join(root, "backlog", "rename.md"), "base\n", "utf8");
    execFileSync("git", ["add", "backlog/rename.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base rename file"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", "feature/rename"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["mv", "backlog/rename.md", "backlog/renamed.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-am", "feat: rename file"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-rename",
          entropy: "entropy-rename",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const renamedIdentity = createRuntimeLockIdentity("backlog/renamed.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-rename",
          path: renamedIdentity.path,
          key: renamedIdentity.key,
        }),
      );

      const audit = store.auditChangedFiles(claim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit.passed).toBe(false);
      expect(audit.renameDiagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "runtime-rename-detected",
          }),
        ]),
      );
      expect(audit.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "backlog/renamed.md",
            actualLockState: "rename-detected",
            recommendedNextCommand: expect.stringContaining(
              "dv claim release",
            ),
          }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("fails terminal audit when the branch is stale relative to the merge target", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.writeFile(path.join(root, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", "feature/stale"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.appendFile(path.join(root, "README.md"), "feature\n");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: feature"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
    await fs.appendFile(path.join(root, "CHANGELOG.md"), "main\n");
    execFileSync("git", ["add", "CHANGELOG.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: main ahead"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "feature/stale"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-stale",
          entropy: "entropy-stale",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const identity = createRuntimeLockIdentity("README.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-stale",
          path: identity.path,
          key: identity.key,
        }),
      );

      const audit = store.auditChangedFiles(claim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit.passed).toBe(false);
      expect(audit.fresh).toBe(false);
      expect(audit.mergeable).toBe(true);
    } finally {
      store.close();
    }
  });

  it("fails terminal audit when the branch cannot be merged cleanly", async () => {
    const root = await mkRoot();
    await initGitRepo(root);
    await fs.writeFile(path.join(root, "README.md"), "line one\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", "feature/conflict"], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.writeFile(path.join(root, "README.md"), "feature line\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: feature"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
    await fs.writeFile(path.join(root, "README.md"), "main line\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: main"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "feature/conflict"], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-conflict",
          entropy: "entropy-conflict",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }
      const identity = createRuntimeLockIdentity("README.md", {
        rootDir: root,
        cwd: root,
      });
      store.insertLock(
        makeLock(root, {
          claim_token: claim.claimToken,
          target_id: "wi-conflict",
          path: identity.path,
          key: identity.key,
        }),
      );

      const audit = store.auditChangedFiles(claim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit.passed).toBe(false);
      expect(audit.mergeable).toBe(false);
    } finally {
      store.close();
    }
  });

  it("fails terminal audit when freshness, mergeability, and lock coverage all disagree", async () => {
    const root = await mkRoot();
    const featureBranch = "feature/audit-contract";
    const readmePath = path.join(root, "README.md");
    const unlockedPath = path.join(root, "backlog", "unlocked.md");

    await initGitRepo(root);
    await fs.mkdir(path.join(root, "backlog"), { recursive: true });
    await fs.writeFile(readmePath, "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "chore: base"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "-c", featureBranch], {
      cwd: root,
      stdio: "ignore",
    });
    await fs.writeFile(readmePath, "feature line\n", "utf8");
    await fs.writeFile(unlockedPath, "feature\n", "utf8");
    execFileSync("git", ["add", "README.md", "backlog/unlocked.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: feature branch"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
    await fs.writeFile(path.join(root, "README.md"), "main line\n", "utf8");
    execFileSync("git", ["add", "README.md"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "feat: main branch"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["switch", featureBranch], {
      cwd: root,
      stdio: "ignore",
    });

    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      const claim = store.acquireRuntimeClaim(
        makeClaimSeed({
          target_id: "wi-audit-contract",
          entropy: "entropy-audit-contract",
          expires_at: "2099-06-23T05:14:36.020Z",
        }),
        {
          initialLockPaths: ["README.md"],
        },
      );
      if (claim.outcome !== "acquired") {
        throw new Error("Expected the claim to be acquired.");
      }

      const audit = store.auditChangedFiles(claim.claimToken, {
        mergeTargetRef: "main",
      });

      expect(audit).toMatchObject({
        claimToken: claim.claimToken,
        mergeTargetRef: "main",
        fresh: false,
        mergeable: false,
        passed: false,
      });
      expect(audit.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "backlog/unlocked.md",
            actualLockState: "missing",
          }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("stores execution log payloads as canonical JSON and validates them before insert", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      store.insertClaim(makeClaim({ claim_token: "claim-log", target_id: "wi-log" }));
      const inserted = store.insertExecutionLogEntry(
        makeExecutionLogEntry({
          claim_token: "claim-log",
          target_id: "wi-log",
          detail: {
            message: "Runtime claim acquired.",
            code: "x-runtime-started",
          },
        }),
      );

      expect(inserted.payload).toBe(
        JSON.stringify({
          claim_token: "claim-log",
          created_at: "2026-06-20T01:14:41.020Z",
          detail: {
            code: "x-runtime-started",
            message: "Runtime claim acquired.",
          },
          reason: "started",
          schema_version: RUNTIME_SCHEMA_VERSION,
          state: "running",
          target_id: "wi-log",
          target_type: "task",
        }),
      );

      expect(() =>
        store.insertExecutionLogEntry(
          42 as unknown as RuntimeExecutionLogEntry,
        ),
      ).toThrow("Invalid runtime execution log entry payload.");

      expect(() =>
        store.insertExecutionLogEntry(
          makeExecutionLogEntry({
            claim_token: "claim-log",
            target_id: "wi-log",
            reason: "success" as RuntimeExecutionLogEntry["reason"],
          }),
        ),
      ).toThrow("Invalid runtime execution log entry payload.");
    } finally {
      store.close();
    }
  });

  it("rolls back multi-table mutations when a later write fails validation", async () => {
    const root = await mkRoot();
    const store = openRuntimeSqliteStore({ rootDir: root });
    try {
      expect(() =>
        store.withTransaction(() => {
          store.insertClaim(makeClaim({ claim_token: "claim-tx", target_id: "wi-tx" }));
          store.insertExecutionLogEntry(
            makeExecutionLogEntry({
              claim_token: "claim-tx",
              target_id: "wi-tx",
              reason: "started" as RuntimeExecutionLogEntry["reason"],
              state: "completed" as RuntimeExecutionLogEntry["state"],
            }),
          );
        }),
      ).toThrow("Invalid runtime execution log entry payload.");

      expect(store.listClaims()).toEqual([]);
      expect(store.listExecutionLogEntries()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
