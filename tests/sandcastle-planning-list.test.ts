import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  openRuntimeSqliteStore,
  RUNTIME_SCHEMA_VERSION,
} from "../lib/runtime/sqlite-store.js";
import type { SandcastlePlanningListPayload } from "../lib/sandcastle/planning-list.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const adapterPath = path.resolve(
  __dirname,
  "../scripts/sandcastle/dv4sandcastle.ts",
);

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `doc-vader-sandcastle-planning-${randomUUID()}-`),
  );
  tempDirs.push(rootDir);
  await mkdir(path.join(rootDir, "backlog"), { recursive: true });
  await mkdir(path.join(rootDir, ".doc-vader"), { recursive: true });
  await writeFile(
    path.join(rootDir, ".doc-vader", "backlog-consumer.json"),
    JSON.stringify(
      {
        roots: {
          backlog: "backlog",
          active: "backlog",
          archive: "backlog/archive",
          records: "backlog/records",
          audit: "backlog/audit",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return rootDir;
}

async function writeTask(
  rootDir: string,
  fileName: string,
  frontmatter: string,
  body = "## Goal\n\nExercise Sandcastle planning.\n",
): Promise<void> {
  await writeFile(
    path.join(rootDir, "backlog", fileName),
    `---\n${frontmatter.trim()}\n---\n\n${body}`,
    "utf8",
  );
}

function addActiveRuntimeClaim(rootDir: string, taskId: string, lockPath: string): void {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
    const acquisition = store.acquireRuntimeClaim(
      {
        schema_version: RUNTIME_SCHEMA_VERSION,
        target_type: "task",
        target_id: taskId,
        holder: "sandcastle:agent-a",
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        entropy: randomUUID(),
      },
      { initialLockPaths: [lockPath] },
    );
    if (acquisition.outcome !== "acquired") {
      throw new Error(`Expected active claim acquisition for ${taskId}.`);
    }
  } finally {
    store.close();
  }
}

function addBlockedExecution(rootDir: string, taskId: string): void {
  const store = openRuntimeSqliteStore({ rootDir });
  try {
    store.insertExecutionLogEntry({
      schema_version: RUNTIME_SCHEMA_VERSION,
      claim_token: `claim-${taskId}`,
      target_type: "task",
      target_id: taskId,
      state: "halted",
      reason: "blocked",
      created_at: "2026-06-30T13:00:00.000Z",
      detail: {
        code: "x-runtime-task-blocked",
        message: "Blocked by runtime execution.",
      },
    });
  } finally {
    store.close();
  }
}

function runAdapter(rootDir: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, adapterPath, ...args],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
      },
    },
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe("sandcastle planning list surface", () => {
  it("returns only selectable candidates to Sandcastle", async () => {
    const rootDir = await createTempRepo();

    await writeTask(
      rootDir,
      "100-ready-afk.md",
      `id: wi-100
title: Ready AFK
summary: The only selectable planning candidate.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: high
tags:
  - afk`,
    );
    await writeTask(
      rootDir,
      "101-blocked.md",
      `id: wi-101
title: Blocked
summary: Blocked work should not be listed for Sandcastle planning.
type: work-item
subtype: task
lifecycle: active
status: blocked
priority: medium
tags:
  - afk`,
    );
    await writeTask(
      rootDir,
      "102-claimed.md",
      `id: wi-102
title: Claimed
summary: Claimed work should not be selectable.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
tags:
  - afk`,
    );
    await writeTask(
      rootDir,
      "103-hitl.md",
      `id: wi-103
title: HITL
summary: HITL work should not be listed for Sandcastle planning.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: low
tags:
  - afk
  - hitl`,
    );
    await writeTask(
      rootDir,
      "104-runtime-blocked.md",
      `id: wi-104
title: Runtime Blocked
summary: Halted work should not be listed for Sandcastle planning.
type: work-item
subtype: task
lifecycle: active
status: ready
priority: low
tags:
  - afk`,
    );

    addActiveRuntimeClaim(rootDir, "wi-102", "backlog/102-claimed.md");
    addBlockedExecution(rootDir, "wi-104");

    const payload = JSON.parse(runAdapter(rootDir, ["list"])) as PlanningListPayload;

    expect(payload).toMatchObject({
      schemaVersion: "dv4sandcastle-list/v1",
      selectable: [
        {
          id: "100",
          branch: "sandcastle/issue-100",
          priority: "high",
        },
      ],
    });
    expect(payload.selectable.map((entry) => entry.id)).toEqual(["100"]);
    expect(payload.horizon).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("101");
    expect(JSON.stringify(payload)).not.toContain("102");
    expect(JSON.stringify(payload)).not.toContain("103");
    expect(JSON.stringify(payload)).not.toContain("104");
  });
});
