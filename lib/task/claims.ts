import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskCommandError } from "./errors.js";

export type ClaimState = "active" | "expired" | "released" | "missing";

export interface TaskClaim {
  id: string;
  taskId: string;
  holder: string;
  branch?: string;
  sandbox?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  releasedAt?: string;
}

interface ClaimStoreFile {
  claims: TaskClaim[];
}

export interface ClaimStatus {
  claimId: string;
  taskId?: string;
  state: ClaimState;
  claim?: TaskClaim;
}

export interface ClaimTaskOptions {
  rootDir?: string;
  claimStorePath?: string;
  holder?: string;
  branch?: string;
  sandbox?: string;
  ttlMinutes?: number;
  now?: Date;
}

const DEFAULT_TTL_MINUTES = 240;
const CLAIM_STORE_PATH = ".doc-vader/task-claims.json";
const CLAIM_STORE_ENV = "DOC_VADER_TASK_CLAIM_STORE";
const CLAIM_LOCK_TIMEOUT_MS = 10_000;
const CLAIM_LOCK_STALE_MS = 300_000;
const CLAIM_LOCK_RETRY_MS = 25;

function claimStorePath(rootDir: string, overridePath?: string): string {
  if (overridePath?.trim()) {
    return path.isAbsolute(overridePath)
      ? overridePath
      : path.resolve(rootDir, overridePath);
  }
  const configuredPath = process.env[CLAIM_STORE_ENV]?.trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(rootDir, configuredPath);
  }
  return path.resolve(rootDir, CLAIM_STORE_PATH);
}

async function readStore(
  rootDir: string,
  claimStorePathOverride?: string,
): Promise<ClaimStoreFile> {
  try {
    return JSON.parse(
      await fs.readFile(claimStorePath(rootDir, claimStorePathOverride), "utf8"),
    ) as ClaimStoreFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { claims: [] };
    }
    throw error;
  }
}

async function writeStoreUnlocked(
  rootDir: string,
  store: ClaimStoreFile,
  claimStorePathOverride?: string,
): Promise<void> {
  const filePath = claimStorePath(rootDir, claimStorePathOverride);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireStoreLock(
  rootDir: string,
  claimStorePathOverride?: string,
): Promise<() => Promise<void>> {
  const filePath = claimStorePath(rootDir, claimStorePathOverride);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        "utf8",
      );
      return async () => {
        await handle.close();
        await fs.unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      };
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;
      if (lockError.code !== "EEXIST") {
        throw error;
      }

      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > CLAIM_LOCK_STALE_MS) {
        await fs.unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= CLAIM_LOCK_TIMEOUT_MS) {
        throw new TaskCommandError(
          "TASK_CLAIM_STORE_LOCKED",
          "Timed out waiting for the local task claim store lock.",
          { lockPath },
        );
      }
      await wait(CLAIM_LOCK_RETRY_MS);
    }
  }
}

async function updateStore<T>(
  rootDir: string,
  claimStorePathOverride: string | undefined,
  update: (store: ClaimStoreFile) => T | Promise<T>,
): Promise<T> {
  const releaseLock = await acquireStoreLock(rootDir, claimStorePathOverride);
  try {
    const store = await readStore(rootDir, claimStorePathOverride);
    const result = await update(store);
    await writeStoreUnlocked(rootDir, store, claimStorePathOverride);
    return result;
  } finally {
    await releaseLock();
  }
}

function isReleased(claim: TaskClaim): boolean {
  return typeof claim.releasedAt === "string" && claim.releasedAt.length > 0;
}

function isExpired(claim: TaskClaim, now: Date): boolean {
  return Date.parse(claim.expiresAt) <= now.getTime();
}

function getState(claim: TaskClaim, now: Date): Exclude<ClaimState, "missing"> {
  if (isReleased(claim)) {
    return "released";
  }
  if (isExpired(claim, now)) {
    return "expired";
  }
  return "active";
}

function normalizeHolder(holder: string | undefined): string {
  const value = holder?.trim();
  if (value) {
    return value;
  }
  return process.env.USER ?? process.env.USERNAME ?? "local-agent";
}

export async function claimTask(
  taskId: string,
  options: ClaimTaskOptions = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  return updateStore(rootDir, options.claimStorePath, (store) => {
    const conflictingClaim = store.claims.find(
      (claim) => claim.taskId === taskId && getState(claim, now) === "active",
    );
    if (conflictingClaim) {
      throw new TaskCommandError(
        "TASK_CLAIM_CONFLICT",
        `Task '${taskId}' already has an active local claim.`,
        {
          taskId,
          claim: {
            id: conflictingClaim.id,
            holder: conflictingClaim.holder,
            branch: conflictingClaim.branch,
            sandbox: conflictingClaim.sandbox,
            expiresAt: conflictingClaim.expiresAt,
          },
        },
      );
    }

    const expiredClaim = store.claims.find(
      (claim) => claim.taskId === taskId && getState(claim, now) === "expired",
    );
    if (expiredClaim) {
      throw new TaskCommandError(
        "TASK_CLAIM_EXPIRED",
        `Task '${taskId}' has an expired local claim that must be released explicitly.`,
        {
          taskId,
          claimId: expiredClaim.id,
          expiresAt: expiredClaim.expiresAt,
        },
      );
    }

    const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;
    const claim: TaskClaim = {
      id: `claim-${randomUUID()}`,
      taskId,
      holder: normalizeHolder(options.holder),
      ...(options.branch ? { branch: options.branch } : {}),
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    };
    store.claims.push(claim);
    return {
      claimId: claim.id,
      taskId,
      state: getState(claim, now),
      claim,
    };
  });
}

export async function getClaimStatus(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  const claim = store.claims.find((entry) => entry.id === claimId);
  if (!claim) {
    return { claimId, state: "missing" };
  }
  return {
    claimId,
    taskId: claim.taskId,
    state: getState(claim, now),
    claim,
  };
}

export async function releaseClaim(
  claimId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  return updateStore(rootDir, options.claimStorePath, (store) => {
    const claim = store.claims.find((entry) => entry.id === claimId);
    if (!claim) {
      return { claimId, state: "missing" };
    }
    if (!isReleased(claim)) {
      claim.releasedAt = now.toISOString();
      claim.updatedAt = now.toISOString();
    }
    return {
      claimId,
      taskId: claim.taskId,
      state: getState(claim, now),
      claim,
    };
  });
}

export async function getActiveClaimForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim | undefined> {
  return (await getActiveClaimsForTask(taskId, options))[0];
}

export async function getActiveClaimsForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<TaskClaim[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  return store.claims.filter(
    (claim) => claim.taskId === taskId && getState(claim, now) === "active",
  );
}

export async function getClaimStatusForTask(
  taskId: string,
  options: { rootDir?: string; claimStorePath?: string; now?: Date } = {},
): Promise<ClaimStatus | undefined> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const now = options.now ?? new Date();
  const store = await readStore(rootDir, options.claimStorePath);
  const claim = store.claims
    .filter((entry) => entry.taskId === taskId && !isReleased(entry))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  if (!claim) {
    return undefined;
  }
  return {
    claimId: claim.id,
    taskId,
    state: getState(claim, now),
    claim,
  };
}
