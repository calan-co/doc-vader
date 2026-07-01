import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  createRuntimeClaimToken,
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
  type RuntimeClaimAcquisitionSeed,
} from "../../lib/runtime/sqlite-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const workGraphUacFixtureDir = path.resolve(
  __dirname,
  "../fixtures/work-graph-uac",
);
export const workGraphUacRepoDir = path.join(workGraphUacFixtureDir, "repo");
export const workGraphUacExpectedDir = path.join(
  workGraphUacFixtureDir,
  "expected",
);

const claimSeed: RuntimeClaimAcquisitionSeed = {
  schema_version: RUNTIME_SCHEMA_VERSION,
  target_type: "task",
  target_id: "wi-70001",
  holder: "agent-uac-review",
  created_at: "2099-07-01T00:00:00.000Z",
  expires_at: "2099-07-01T04:00:00.000Z",
  entropy: "work-graph-uac-review-fixture",
};
const claimTouchedAt = "2099-07-01T00:05:00.000Z";
const claimExpiresAt = "2099-07-01T04:05:00.000Z";
const readLockAcquiredAt = "2099-07-01T00:05:00.000Z";
const claimToken = createRuntimeClaimToken({
  schema_version: claimSeed.schema_version ?? RUNTIME_SCHEMA_VERSION,
  target_type: claimSeed.target_type,
  target_id: claimSeed.target_id,
  holder: claimSeed.holder,
  created_at: claimSeed.created_at,
  expires_at: claimSeed.expires_at,
  entropy: claimSeed.entropy ?? "",
});

export async function stageWorkGraphUacFixture(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await cp(workGraphUacRepoDir, rootDir, { recursive: true });

  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const acquisition = store.acquireRuntimeClaim(claimSeed, {
      initialLockPaths: [],
    });
    if (acquisition.outcome !== "acquired") {
      throw new Error("Expected deterministic UAC fixture claim acquisition.");
    }
    const lockResult = store.acquireRuntimeScopeLocks(acquisition.claimToken, [
      {
        scopeRef: "wi:70002",
        lockMode: "read",
      },
    ]);
    if (lockResult.outcome !== "acquired") {
      throw new Error("Expected deterministic UAC fixture scope locks.");
    }
  } finally {
    store.close();
  }

  const databasePath = path.join(
    rootDir,
    ".doc-vader",
    "runtime",
    "runtime.sqlite",
  );
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(
        `UPDATE claims
            SET expires_at = ?, last_seen_at = ?
          WHERE claim_token = ?`,
      )
      .run(claimExpiresAt, claimTouchedAt, claimToken);
    database
      .prepare(
        `UPDATE claim_scope_locks
            SET acquired_at = ?, updated_at = ?
          WHERE claim_token = ? AND scope_ref = ? AND lock_mode = 'read'`,
      )
      .run(readLockAcquiredAt, readLockAcquiredAt, claimToken, "wi:70002");
  } finally {
    database.close();
  }
}
