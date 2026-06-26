import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
  type RuntimeInitialClaimAcquisitionResult,
} from "../lib/runtime/index.js";
import {
  renewWorkClaimWithGraphVerification,
  projectWorkGraph,
  type WorkGraphProjection,
} from "../lib/work/index.js";

const tempDirs: string[] = [];
const WORK_ITEM_PATH = path.join(
  "backlog",
  "60389-post-mutation-graph-verification.md",
);
const WORK_ITEM_CONTENT = `---
id: wi-60389
title: Post-Mutation Graph Verification
type: work-item
subtype: task
lifecycle: active
status: ready
status_reason: auto
---

## Goal

Verify graph facts after renewal.
`;
const CLAIM_SNAPSHOT_SQL =
  "UPDATE claims SET last_seen_at = ?, expires_at = ? WHERE claim_token = ?";

async function createTempRepo(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `doc-vader-work-claim-verification-${randomUUID()}`,
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function expectAcquiredClaim(
  result: RuntimeInitialClaimAcquisitionResult,
  description: string,
) {
  expect(result.outcome).toBe("acquired");
  if (result.outcome !== "acquired") {
    throw new Error(`Expected ${description} claim to be acquired.`);
  }
  return result;
}

async function createVerificationRepo(): Promise<string> {
  const rootDir = await createTempRepo();
  await writeMarkdown(path.join(rootDir, WORK_ITEM_PATH), WORK_ITEM_CONTENT);
  return rootDir;
}

interface SeedClaimOptions {
  holder: string;
  entropy: string;
  scopeLocks: Array<{ scopeRef: string; lockMode: "read" | "execute" }>;
}

function seedClaim(
  rootDir: string,
  options: SeedClaimOptions,
): string {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const claim = expectAcquiredClaim(
      store.acquireRuntimeClaim({
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: "wi-60389",
        holder: options.holder,
        created_at: "2099-06-26T00:00:00.000Z",
        expires_at: "2099-06-26T00:30:00.000Z",
        entropy: options.entropy,
      }),
      options.holder,
    );

    expect(
      store.acquireRuntimeScopeLocks(claim.claimToken, options.scopeLocks),
    ).toMatchObject({ outcome: "acquired" });
    store.database
      .prepare(CLAIM_SNAPSHOT_SQL)
      .run(
        "2099-06-26T00:05:00.000Z",
        "2099-06-26T00:30:00.000Z",
        claim.claimToken,
      );
    return claim.claimToken;
  } finally {
    store.close();
  }
}

function removeClaimLockEdge(
  projection: WorkGraphProjection,
  claimToken: string,
  scopeNodeId: string,
): WorkGraphProjection {
  const filteredEdges = projection.edges.filter(
    (edge) =>
      !(
        edge.type === "locks" &&
        edge.from === `claim:${claimToken}` &&
        edge.to === scopeNodeId
      ),
  );

  return {
    ...projection,
    edges: filteredEdges,
    getEdgesByType(type) {
      return filteredEdges.filter((edge) => edge.type === type);
    },
    getOutgoingEdges(nodeId) {
      return filteredEdges.filter((edge) => edge.from === nodeId);
    },
    getIncomingEdges(nodeId) {
      return filteredEdges.filter((edge) => edge.to === nodeId);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("work claim graph verification", () => {
  it("reprojects and verifies graph facts after a scope-gated renewal mutation", async () => {
    const rootDir = await createVerificationRepo();
    const claimToken = seedClaim(rootDir, {
      holder: "renew verification",
      entropy: "claim-renew-verify",
      scopeLocks: [
        { scopeRef: "wi-60387", lockMode: "execute" },
        { scopeRef: "wi-60388", lockMode: "read" },
      ],
    });

    const renewed = await renewWorkClaimWithGraphVerification({
      rootDir,
      claimToken,
      now: new Date("2099-06-26T00:10:00.000Z"),
      ttlMilliseconds: 30 * 60_000,
    });

    expect(renewed).toMatchObject({
      outcome: "renewed",
      claimToken,
      claim: {
        claim_token: claimToken,
        target_id: "wi-60389",
        last_seen_at: "2099-06-26T00:10:00.000Z",
        expires_at: "2099-06-26T00:40:00.000Z",
      },
      verification: {
        before: {
          claimNodeId: `claim:${claimToken}`,
        },
        after: {
          claimNodeId: `claim:${claimToken}`,
          lockEdgeCount: 3,
        },
      },
    });
  });

  it("fails closed with deterministic diagnostics when post-mutation graph facts are missing", async () => {
    const rootDir = await createVerificationRepo();
    const claimToken = seedClaim(rootDir, {
      holder: "renew mismatch",
      entropy: "claim-renew-mismatch",
      scopeLocks: [{ scopeRef: "wi-60388", lockMode: "read" }],
    });

    let projectionCount = 0;
    await expect(
      renewWorkClaimWithGraphVerification({
        rootDir,
        claimToken,
        now: new Date("2099-06-26T00:10:00.000Z"),
        ttlMilliseconds: 30 * 60_000,
        project: async (options): Promise<WorkGraphProjection> => {
          projectionCount += 1;
          const projection = await projectWorkGraph(options);
          if (projectionCount === 1) {
            return projection;
          }
          return removeClaimLockEdge(
            projection,
            claimToken,
            "scope:wi:60388",
          );
        },
      }),
    ).rejects.toMatchObject({
      code: "WORK_GRAPH_VERIFICATION_FAILED",
      claimToken,
      diagnostics: [
        {
          kind: "missing-edge",
          edgeType: "locks",
          from: `claim:${claimToken}`,
          to: "scope:wi:60388",
          detail: `Missing locks edge 'claim:${claimToken}' -> 'scope:wi:60388' for read scope 'wi:60388'.`,
        },
      ],
    });
  });
});
