import { afterEach, describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TSchema } from "@sinclair/typebox";
import {
  RUNTIME_SCHEMA_VERSION,
  RuntimeClaimSchema,
  RuntimeDetailCodeSchema,
  RuntimeExecutionLogEntrySchema,
  RuntimeExecutionReasonSchema,
  RuntimeExecutionStateReasonMatrix,
  RuntimeExecutionStateSchema,
  RuntimeLockSchema,
  RuntimeRenameDetectionError,
  createRuntimeLockIdentity,
  deriveRuntimeLockKey,
  assertRuntimeRenameDiagnostics,
  detectRuntimeRenameDiagnostics,
  isRuntimeExecutionLogEntry,
  isRuntimeLock,
  normalizeRuntimeLockPath,
} from "../lib/runtime/entity-schemas.js";
import {
  persistRuntimeClaimForWrite,
  persistRuntimeExecutionLogEntryForWrite,
  persistRuntimeLockForWrite,
  serializeRuntimeEntityForWrite,
} from "../lib/runtime/sqlite-store.js";

const tempDirs: string[] = [];
const runtimeFixturesDir = fileURLToPath(
  new URL("./fixtures/runtime-entities/", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function compileValidator(schema: TSchema) {
  return createAjv().compile(schema);
}

async function readFixture(name: string) {
  return JSON.parse(
    await fs.readFile(path.join(runtimeFixturesDir, name), "utf8"),
  );
}

async function mkRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-runtime-"));
  tempDirs.push(root);
  return root;
}

describe("runtime entity schemas", () => {
  it("exports bounded schema metadata and execution compatibility", () => {
    expect(RuntimeClaimSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(RuntimeLockSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(RuntimeExecutionLogEntrySchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(RUNTIME_SCHEMA_VERSION).toBe("runtime-entity/v1");
    expect(RuntimeExecutionStateSchema.anyOf?.map((item) => item.const)).toEqual([
      "running",
      "completed",
      "halted",
      "failed",
    ]);
    expect(RuntimeExecutionReasonSchema.anyOf?.map((item) => item.const)).toEqual([
      "started",
      "success",
      "error",
      "conflict",
      "blocked",
      "invalid",
      "expired",
      "revoked",
      "cancelled",
    ]);
    expect(RuntimeExecutionStateReasonMatrix).toEqual({
      running: ["started"],
      completed: ["success"],
      failed: ["error"],
      halted: [
        "conflict",
        "blocked",
        "invalid",
        "expired",
        "revoked",
        "cancelled",
      ],
    });
    expect(RuntimeDetailCodeSchema.pattern).toContain("x-");
  });

  it("validates representative claim, lock, and execution-log fixtures", async () => {
    const validateClaim = compileValidator(RuntimeClaimSchema);
    const validateLock = compileValidator(RuntimeLockSchema);
    const validateExecutionLogEntry = compileValidator(
      RuntimeExecutionLogEntrySchema,
    );

    const claim = await readFixture("claim.valid.json");
    const lock = await readFixture("lock.valid.json");
    const executionLogEntry = await readFixture("execution-log-entry.valid.json");

    expect(validateClaim(claim)).toBe(true);
    expect(validateLock(lock)).toBe(true);
    expect(validateExecutionLogEntry(executionLogEntry)).toBe(true);
    expect(isRuntimeLock(lock)).toBe(true);
    expect(isRuntimeExecutionLogEntry(executionLogEntry)).toBe(true);
  });

  it("rejects missing schema versions, invalid enums, and invalid extension codes", async () => {
    const validateClaim = compileValidator(RuntimeClaimSchema);
    const validateExecutionLogEntry = compileValidator(
      RuntimeExecutionLogEntrySchema,
    );

    const missingSchemaVersion = await readFixture(
      "claim.invalid-missing-schema-version.json",
    );
    const invalidExecutionState = await readFixture(
      "execution-log-entry.invalid-state.json",
    );
    const invalidExtensionCode = await readFixture(
      "execution-log-entry.invalid-extension-code.json",
    );

    expect(validateClaim(missingSchemaVersion)).toBe(false);
    expect(validateExecutionLogEntry(invalidExecutionState)).toBe(false);
    expect(validateExecutionLogEntry(invalidExtensionCode)).toBe(false);
  });

  it("validates runtime payloads before durable writes", async () => {
    const claim = await readFixture("claim.valid.json");
    const lock = await readFixture("lock.valid.json");
    const executionLogEntry = await readFixture("execution-log-entry.valid.json");

    const writes: string[] = [];
    const write = async (payload: string) => {
      writes.push(payload);
    };

    await expect(persistRuntimeClaimForWrite(claim, write)).resolves.toBeUndefined();
    await expect(persistRuntimeLockForWrite(lock, write)).resolves.toBeUndefined();
    await expect(
      persistRuntimeExecutionLogEntryForWrite(executionLogEntry, write),
    ).resolves.toBeUndefined();

    expect(writes).toHaveLength(3);

    await expect(
      persistRuntimeClaimForWrite(
        {
          ...claim,
          schema_version: "runtime-entity/v2",
        },
        write,
      ),
    ).rejects.toThrow("Invalid runtime claim payload.");
    await expect(
      persistRuntimeLockForWrite(
        {
          ...lock,
          key: "not-a-sha256-key",
        },
        write,
      ),
    ).rejects.toThrow("Invalid runtime lock payload.");
    await expect(
      persistRuntimeExecutionLogEntryForWrite(
        {
          ...executionLogEntry,
          schema_version: "runtime-entity/v2",
        },
        write,
      ),
    ).rejects.toThrow("Invalid runtime execution log entry payload.");

    expect(writes).toHaveLength(3);
  });

  it("rejects unsupported runtime entity kinds", async () => {
    const claim = await readFixture("claim.valid.json");

    expect(() =>
      serializeRuntimeEntityForWrite("unsupported" as never, claim),
    ).toThrow("Unsupported runtime entity kind: unsupported");
  });

  it("derives normalized lock identities and stable keys", async () => {
    const root = await mkRoot();
    const nestedFilePath = path.join(root, "backlog", "runtime", "entity.md");
    await fs.mkdir(path.dirname(nestedFilePath), { recursive: true });
    await fs.writeFile(nestedFilePath, "# runtime\n", "utf8");

    expect(normalizeRuntimeLockPath("./backlog/runtime/entity.md", root)).toBe(
      "backlog/runtime/entity.md",
    );
    expect(createRuntimeLockIdentity("./backlog/runtime/entity.md", root)).toEqual(
      {
        path: "backlog/runtime/entity.md",
        key: deriveRuntimeLockKey("backlog/runtime/entity.md"),
      },
    );
  });

  it("normalizes absolute and relative inputs against the repository root", async () => {
    const root = await mkRoot();
    const nestedDir = path.join(root, "backlog", "runtime");
    const nestedFile = path.join(nestedDir, "entity.md");
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(nestedFile, "# runtime\n", "utf8");

    const relativeIdentity = createRuntimeLockIdentity("backlog/runtime/entity.md", {
      rootDir: root,
      cwd: root,
    });
    const absoluteIdentity = createRuntimeLockIdentity(nestedFile, {
      rootDir: root,
      cwd: root,
    });

    expect(relativeIdentity).toEqual(absoluteIdentity);
    expect(relativeIdentity.path).toBe("backlog/runtime/entity.md");
  });

  it("preserves caller casing for new path segments while canonicalizing tracked prefixes", async () => {
    const root = await mkRoot();
    const identity = createRuntimeLockIdentity("./BACKLOG/runtime/NewFolder/entry.md", {
      rootDir: root,
      cwd: root,
      gitIgnoreCase: true,
      trackedPaths: ["backlog/runtime/Tracked.md"],
    });

    expect(identity.path).toBe("backlog/runtime/NewFolder/entry.md");
    expect(identity.key).toBe(deriveRuntimeLockKey(identity.path));
  });

  it("preserves exact casing when ignorecase is disabled", async () => {
    const root = await mkRoot();
    const identity = createRuntimeLockIdentity("./Backlog/Runtime/Entry.md", {
      rootDir: root,
      cwd: root,
      gitIgnoreCase: false,
      trackedPaths: ["backlog/runtime/Entry.md"],
    });

    expect(identity.path).toBe("Backlog/Runtime/Entry.md");
  });

  it("rejects repository escapes and directory lock targets", async () => {
    const root = await mkRoot();
    const nestedDir = path.join(root, "backlog", "runtime");
    await fs.mkdir(nestedDir, { recursive: true });

    expect(() =>
      normalizeRuntimeLockPath("../outside.md", {
        rootDir: root,
        cwd: root,
      }),
    ).toThrow("Lock path escapes the repository root: ../outside.md");

    expect(() =>
      createRuntimeLockIdentity("backlog/runtime", {
        rootDir: root,
        cwd: root,
      }),
    ).toThrow("Lock path targets a directory, not a file: backlog/runtime");
  });

  it("detects rename diagnostics and blocks terminal success", () => {
    const diagnostics = detectRuntimeRenameDiagnostics([
      {
        status: "R100",
        previousPath: "backlog/runtime/entity.md",
        path: "backlog/runtime/entity-renamed.md",
      },
      {
        status: "R100",
        previousPath: "backlog/runtime/Entity.md",
        path: "backlog/runtime/entity.md",
      },
    ]);

    expect(diagnostics).toEqual([
      {
        code: "runtime-rename-detected",
        message: "Git rename detected.",
        details: {
          status: "R100",
          previousPath: "backlog/runtime/entity.md",
          path: "backlog/runtime/entity-renamed.md",
          caseOnly: false,
        },
      },
      {
        code: "runtime-case-only-rename-detected",
        message: "Git case-only rename detected.",
        details: {
          status: "R100",
          previousPath: "backlog/runtime/Entity.md",
          path: "backlog/runtime/entity.md",
          caseOnly: true,
        },
      },
    ]);

    expect(() =>
      assertRuntimeRenameDiagnostics(diagnostics.map((entry) => ({
        status: entry.details.status,
        previousPath: entry.details.previousPath,
        path: entry.details.path,
      }))),
    ).toThrow(RuntimeRenameDetectionError);
  });
});
