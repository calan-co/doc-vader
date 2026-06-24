import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "cli/doc-vader.ts");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;

let testDir = "";

async function mkTmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-archive-validate-"));
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.mkdir(path.join(root, ".doc-vader"), { recursive: true });
  await fs.mkdir(path.join(root, "schemas", "archive"), { recursive: true });
  return root;
}

async function write(
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(testDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function runCli(args: string[], env?: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", ["--import", tsxImport, cliPath, ...args], {
      cwd: testDir,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const child = error as { status?: number; stdout?: string; stderr?: string };
      return {
        code: child.status ?? 1,
        stdout: child.stdout ?? "",
        stderr: child.stderr ?? "",
      };
    }
    throw error;
  }
}

beforeEach(async () => {
  testDir = await mkTmpRoot();
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("backlog archive validation", () => {
  it("uses configured archive roots and validates declared and fallback schemas", { timeout: 15_000 }, async () => {
    await write(
      "schemas/archive/work-item.json",
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "/archive/work-item",
          type: "object",
          required: ["id", "type", "status", "lifecycle"],
          properties: {
            id: { type: "string" },
            type: { const: "work-item" },
            status: { type: "string" },
            lifecycle: { type: "string" },
            title: { type: "string" },
          },
          additionalProperties: true,
        },
        null,
        2,
      ),
    );
    await write(
      "schemas/archive/fallback-work-item.json",
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "/archive/fallback-work-item",
          type: "object",
          required: ["id", "type", "status"],
          properties: {
            id: { type: "string" },
            type: { const: "work-item" },
            status: { type: "string" },
            lifecycle: { type: "string" },
          },
          additionalProperties: true,
        },
        null,
        2,
      ),
    );
    await write(
      ".doc-vader/backlog-consumer.json",
      JSON.stringify(
        {
          roots: {
            backlog: "backlog",
            active: "backlog",
            archive: "history/done",
            records: "backlog/records",
            audit: "backlog/audit",
          },
          automation: {
            archiveValidation: {
              fallbackSchema: "schemas/archive/fallback-work-item.json",
              missingSchemaSeverity: "warn",
            },
          },
        },
        null,
        2,
      ),
    );
    await write(
      "history/done/1.declared.md",
      `---\n$schema: schemas/archive/work-item.json\nid: archived-1\ntype: work-item\nlifecycle: inactive\nstatus: closed\ntitle: Declared archive item\n---\n`,
    );
    await write(
      "history/done/2.legacy.md",
      `---\nid: archived-2\ntype: work-item\nlifecycle: inactive\nstatus: closed\ntitle: Legacy archive item\n---\n`,
    );
    const beforeDeclared = await fs.readFile(path.join(testDir, "history/done/1.declared.md"), "utf8");
    const beforeLegacy = await fs.readFile(path.join(testDir, "history/done/2.legacy.md"), "utf8");

    const result = runCli(["backlog", "archive", "validate", "--format", "json"]);
    expect(result.code).toBe(0);

    const report = JSON.parse(result.stdout) as {
      options: { archiveRoots: string[] };
      totals: { files: number; declaredSchemas: number; fallbackSchemas: number; missingSchemas: number };
      findings: Array<{ file: string; kind: string; severity: string }>;
      exitCode: number;
    };

    expect(report.options.archiveRoots).toEqual(["history/done"]);
    expect(report.totals.files).toBe(2);
    expect(report.totals.declaredSchemas).toBe(1);
    expect(report.totals.fallbackSchemas).toBe(1);
    expect(report.totals.missingSchemas).toBe(1);
    expect(report.exitCode).toBe(0);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "history/done/2.legacy.md",
          kind: "missing-schema",
          severity: "warn",
        }),
      ]),
    );

    await expect(fs.readFile(path.join(testDir, "history/done/1.declared.md"), "utf8")).resolves.toBe(beforeDeclared);
    await expect(fs.readFile(path.join(testDir, "history/done/2.legacy.md"), "utf8")).resolves.toBe(beforeLegacy);
    expect(beforeDeclared).not.toContain("validated_at");
    expect(beforeDeclared).not.toContain("validated_by");
    expect(beforeLegacy).not.toContain("validated_at");
    expect(beforeLegacy).not.toContain("validated_by");
  });

  it("fails closed when the consumer config is missing or malformed", async () => {
    const missingConfig = runCli([
      "backlog",
      "archive",
      "validate",
      "--consumer-config",
      ".doc-vader/missing.json",
    ]);

    expect(missingConfig.code).toBe(1);
    expect(missingConfig.stderr).toMatch(/backlog-consumer\.json|consumer config/i);

    await write(
      ".doc-vader/backlog-consumer.json",
      "{ not-json",
    );

    const malformedConfig = runCli([
      "backlog",
      "archive",
      "validate",
    ]);

    expect(malformedConfig.code).toBe(1);
    expect(malformedConfig.stderr).toMatch(/malformed|parse/i);
  });

  it("rejects disallowed external schemas instead of fetching arbitrary URLs", async () => {
    await write(
      ".doc-vader/backlog-consumer.json",
      JSON.stringify(
        {
          roots: {
            backlog: "backlog",
            active: "backlog",
            archive: "backlog/archive",
            records: "backlog/records",
            audit: "backlog/audit",
          },
          automation: {
            archiveValidation: {
              fallbackSchema: "schemas/archive/fallback-work-item.json",
              missingSchemaSeverity: "warn",
            },
          },
        },
        null,
        2,
      ),
    );
    await write(
      "backlog/archive/3.external.md",
      `---\n$schema: https://example.com/archive-work-item.json\nid: archived-3\ntype: work-item\nstatus: closed\nlifecycle: inactive\n---\n`,
    );

    const result = runCli(["backlog", "archive", "validate", "--format", "json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/allowlisted|repo-local|external schema/i);
  });
});
