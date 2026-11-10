import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { auditBacklog } from "../lib/backlog/audit.js";

const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;

function runCli(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    return {
      code: 0,
      stdout: execFileSync(
        process.execPath,
        ["--import", tsxImport, path.join(repoRoot, "cli/doc-vader.ts"), ...args],
        { cwd, encoding: "utf8" },
      ),
    };
  } catch (error) {
    const child = error as { status?: number; stdout?: string };
    return { code: child.status ?? 1, stdout: child.stdout ?? "" };
  }
}

async function mkTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe("auditBacklog", () => {
  it("detects duplicate ids and unresolved wikilinks as errors", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-audit-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "1.alpha.md"),
      `---\nid: "1"\ntitle: A\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: high\nlinks:\n  - references: "[[missing-item]]"\n---\n`
    );
    await writeFile(
      path.join(tmp, "1.beta.md"),
      `---\nid: "1"\ntitle: B\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: high\n---\n`
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      failOn: "error",
      format: "json",
    });

    expect(report.totals.duplicate_ids).toBe(1);
    expect(report.totals.unresolved_wikilinks).toBeGreaterThan(0);
    expect(report.exit_code).toBe(1);
  });

  it("applies profile failOn/format and fails on warnings", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-profile-");
    cleanupDirs.push(tmp);

    const profilePath = path.join(tmp, "profile.json");
    await writeFile(
      profilePath,
      JSON.stringify(
        {
          backlogValidation: {
            failOn: "warning",
            format: "json",
          },
        },
        null,
        2
      )
    );

    await writeFile(
      path.join(tmp, "2.single.md"),
      `---\nid: "2"\ntitle: Single\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: medium\n---\n`
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      profile: profilePath,
    });

    expect(report.options.failOn).toBe("warning");
    expect(report.options.format).toBe("json");
    expect(report.totals.no_inbound_active).toBe(1);
    expect(report.exit_code).toBe(1);
  });

  it("merges multiple profiles deterministically and records them in options", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-multi-profile-");
    cleanupDirs.push(tmp);

    const profileA = path.join(tmp, "profile-a.json");
    const profileB = path.join(tmp, "profile-b.json");

    await writeFile(
      profileA,
      JSON.stringify(
        {
          backlogValidation: {
            failOn: "error",
            format: "text",
          },
        },
        null,
        2,
      ),
    );

    await writeFile(
      profileB,
      JSON.stringify(
        {
          backlogValidation: {
            failOn: "warning",
            format: "json",
            includeArchive: true,
          },
        },
        null,
        2,
      ),
    );

    await writeFile(
      path.join(tmp, "4.single.md"),
      `---\nid: "4"\ntitle: Single\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: medium\n---\n`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      profiles: [profileA, profileB],
    });

    expect(report.options.profiles).toEqual([profileA, profileB]);
    expect(report.options.profile).toBe(profileA);
    expect(report.options.failOn).toBe("warning");
    expect(report.options.format).toBe("json");
    expect(report.options.includeArchive).toBe(true);
  });

  it("accepts comma-separated profiles through the audit options", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-comma-profile-");
    cleanupDirs.push(tmp);

    const profileA = path.join(tmp, "profile-a.json");
    const profileB = path.join(tmp, "profile-b.json");

    await writeFile(
      profileA,
      JSON.stringify({ backlogValidation: { failOn: "error" } }, null, 2),
    );
    await writeFile(
      profileB,
      JSON.stringify({ backlogValidation: { format: "json" } }, null, 2),
    );

    await writeFile(
      path.join(tmp, "5.single.md"),
      `---\nid: "5"\ntitle: Single\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: medium\n---\n`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      profile: `${profileA},${profileB}`,
    });

    expect(report.options.profiles).toEqual([profileA, profileB]);
    expect(report.options.format).toBe("json");
  });

  it("chains schema maps from multiple selected profiles in deterministic order", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-schema-chain-");
    cleanupDirs.push(tmp);

    const profileA = path.join(tmp, "profile-a.json");
    const profileB = path.join(tmp, "profile-b.json");
    const schemaMapA = path.join(tmp, "schema-map-a.json");
    const schemaMapB = path.join(tmp, "schema-map-b.json");

    await writeFile(
      schemaMapA,
      JSON.stringify(
        { default: "schemas/frontmatter/by-type/document/latest.json" },
        null,
        2,
      ),
    );
    await writeFile(
      schemaMapB,
      JSON.stringify(
        { byType: { "work-item": "schemas/work-management/frontmatter/work-item.json" } },
        null,
        2,
      ),
    );

    await writeFile(
      profileA,
      JSON.stringify({ backlogValidation: { schemaMap: schemaMapA } }, null, 2),
    );
    await writeFile(
      profileB,
      JSON.stringify({ backlogValidation: { schemaMap: schemaMapB } }, null, 2),
    );

    await writeFile(
      path.join(tmp, "6.single.md"),
      `---\nid: "6"\ntitle: Single\ntype: work-item\nsubtype: task\nlifecycle: draft\nstatus: proposed\npriority: medium\n---\n`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      profiles: [profileA, profileB],
    });

    expect(report.options.schemaMaps).toEqual([schemaMapA, schemaMapB]);
    expect(report.options.schemaMap).toBe(schemaMapB);
  });

  it("resolves wikilinks to archived backlog targets even when includeArchive is false", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-archive-resolution-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "archive", "old-item.md"),
      `---\nid: "old"\ntitle: Old\ntype: work-item\nsubtype: task\nlifecycle: archived\nstatus: closed\npriority: low\n---\n`
    );

    await writeFile(
      path.join(tmp, "3.active.md"),
      `---\nid: "3"\ntitle: Active\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: in-progress\npriority: high\nlinks:\n  depends_on:\n    - "[[old-item]]"\n---\n`
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      failOn: "error",
      format: "json",
      includeArchive: false,
    });

    expect(report.totals.unresolved_wikilinks).toBe(0);
  });

  it("fails --fail-on error when a selected schema cannot load", async () => {
    const root = await mkTmpDir("doc-vader-backlog-schema-load-error-");
    cleanupDirs.push(root);
    await writeFile(
      path.join(root, "backlog", "missing-schema.md"),
      `---\nid: wi-missing\ntitle: Missing schema\ntype: work-item\n$schema: schemas/missing.json\nlifecycle: active\nstatus: ready\npriority: high\n---\n`,
    );

    const result = runCli(root, [
      "backlog",
      "validate",
      "--dir",
      "backlog",
      "--format",
      "json",
      "--fail-on",
      "error",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).schema_load_errors).toHaveLength(1);
  });

  it("resolves explicit consumer-relative schemas from an external runtime schema map", async () => {
    const root = await mkTmpDir("doc-vader-external-schema-map-");
    cleanupDirs.push(root);
    await writeFile(
      path.join(root, "backlog", "external-runtime.md"),
      `---\nid: wi-60527\ntitle: External runtime\ntype: work-item\n$schema: schemas/work-management/frontmatter/work-item.json\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\n---\n`,
    );

    const report = await auditBacklog({
      rootDir: root,
      backlogDir: path.join(root, "backlog"),
      schemaMap: path.join(repoRoot, "schemas/frontmatter/schema-map.json"),
      failOn: "error",
    });

    expect(report.schema_load_errors).toEqual([]);
    expect(report.exit_code).toBe(0);
  });

  it("routes work items through the canonical frontmatter schema by default", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-canonical-routing-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "7.canonical.md"),
      `---\nid: wi-7\ntitle: Canonical Route\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\n---\n`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      failOn: "error",
      format: "json",
    });

    expect(report.totals.schema_violations).toBe(0);
    expect(report.schema_violations).toHaveLength(0);
  });
});
