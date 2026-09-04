import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { auditBacklog } from "../lib/backlog/audit.js";

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
        { byType: { "work-item": "schemas/frontmatter/work-item/1.0.0.json" } },
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

  it("routes work items through the canonical frontmatter schema by default", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-canonical-routing-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "7.canonical.md"),
      `---\nid: wi-7\ntitle: Canonical Route\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\nestimated: 1\n---\n`,
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

  it("validates Work Management record subtypes through the backlog audit", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-work-management-record-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "record.md"),
      `---
$schema: schemas/work-management/frontmatter/record.json
id: record:subtype-resolution
title: Record subtype resolution
summary: Verify the audit resolves Work Management record subtypes.
type: record
subtype: test-result
lifecycle: active
status: ready
status_reason: recorded
---
`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      failOn: "error",
      format: "json",
    });

    expect(report.schema_load_errors).toHaveLength(0);
    expect(report.schema_violations).toHaveLength(0);
  });

  it("allows standard work-item link vocabulary and x-prefixed extension links", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-link-vocabulary-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "8.parent.md"),
      `---\nid: wi-8\ntitle: Parent\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\nestimated: 1\n---\n`,
    );
    await writeFile(
      path.join(tmp, "9.child.md"),
      `---\nid: wi-9\ntitle: Child\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\nestimated: 1\nlinks:\n  parent:\n    - '[[8.parent]]'\n  implements:\n    - '[[8.parent]]'\n  x-traces-to:\n    - '[[8.parent]]'\n---\n`,
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

  it("resolves bare wikilinks from the configured repository root rather than the CWD", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-cwd-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "target.md"), "---\nid: target\nstatus: closed\n---\n");
    await writeFile(
      path.join(root, "backlog", "source.md"),
      "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[target]]'\n---\n",
    );

    const report = await auditBacklog({
      rootDir: root,
      backlogDir: path.join(root, "backlog"),
      format: "json",
    });

    expect(report.unresolved_wikilinks).toHaveLength(0);
  });

  it("prefers a nearer descendant directory for bare wikilinks", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-descendant-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "near", "target.md"), "---\nid: near\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "far", "nested", "target.md"), "---\nid: far\nstatus: closed\n---\n");
    await writeFile(
      path.join(root, "backlog", "source.md"),
      "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[target]]'\n---\n",
    );

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(0);
  });

  it("prefers the nearest ancestor directory for bare wikilinks", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-ancestor-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "records", "target.md"), "---\nid: near\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "target.md"), "---\nid: far\nstatus: closed\n---\n");
    await writeFile(
      path.join(root, "backlog", "records", "nested", "source.md"),
      "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[target]]'\n---\n",
    );

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(0);
  });

  it("fails closed for same-tier bare wikilink matches", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-ambiguous-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "one", "target.md"), "---\nid: one\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "two", "target.md"), "---\nid: two\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "source.md"), "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[target]]'\n---\n");

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toEqual([
      expect.objectContaining({ ref: "target", reason: "ambiguous", candidates: expect.arrayContaining(["backlog/one/target.md", "backlog/two/target.md"]) }),
    ]);
  });

  it("honors explicit paths despite a closer basename collision", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-explicit-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "target.md"), "---\nid: target\nstatus: ready\n---\n");
    await writeFile(path.join(root, "backlog", "records", "target.md"), "---\nid: collision\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "records", "source.md"), "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[../target.md]]'\n---\n");

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(0);
    expect(report.no_inbound_active).toHaveLength(0);
  });

  it("resolves explicit links to regular JSON repository artifacts", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-json-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "audit", "report.json"), "{}\n");
    await writeFile(path.join(root, "backlog", "records", "source.md"), "---\nid: source\nstatus: closed\nlinks:\n  supporting_reference:\n    - '[[../audit/report.json]]'\n---\n");

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(0);
  });

  it("rejects root escapes and nonregular or symlink wikilink targets", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-safety-");
    cleanupDirs.push(root);
    await fs.mkdir(path.join(root, "backlog", "directory-target"), { recursive: true });
    await writeFile(path.join(root, "outside.md"), "outside\n");
    await fs.symlink(path.join(root, "outside.md"), path.join(root, "backlog", "symlink-target.md"));
    await writeFile(path.join(root, "backlog", "source.md"), "---\nid: source\nstatus: closed\nlinks:\n  related:\n    - '[[../../outside.md]]'\n    - '[[directory-target]]'\n    - '[[symlink-target]]'\n---\n");

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(3);
    expect(report.unresolved_wikilinks.map((finding) => finding.reason)).toEqual(["invalid-target", "invalid-target", "invalid-target"]);
  });

  it("keeps accepted unresolved archive history visible outside CI scope", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-archive-history-");
    cleanupDirs.push(root);
    const archiveFile = path.join(
      root,
      "backlog",
      "archive",
      "174.1.graph-and-naming-story 1.md",
    );
    await writeFile(
      archiveFile,
      "---\nid: archived-history\nstatus: closed\nlinks:\n  implementedBy:\n    - '[[174.1.1.registry-utility-task.md]]'\n    - '[[174.1.2.crossref-plugin-task.md]]'\n    - '[[174.1.3.naming-rules-task.md]]'\n    - '[[174.1.4.backlog-lifecycle-rules-task.md]]'\n---\n",
    );

    const ciScope = await auditBacklog({
      rootDir: root,
      backlogDir: path.join(root, "backlog"),
      includeArchive: false,
      format: "json",
    });
    const archiveScope = await auditBacklog({
      rootDir: root,
      backlogDir: path.join(root, "backlog"),
      includeArchive: true,
      format: "json",
    });

    expect(ciScope.unresolved_wikilinks).toHaveLength(0);
    expect(archiveScope.unresolved_wikilinks).toEqual([
      {
        file: "backlog/archive/174.1.graph-and-naming-story 1.md",
        ref: "174.1.1.registry-utility-task.md",
        reason: "not-found",
        candidates: undefined,
      },
      {
        file: "backlog/archive/174.1.graph-and-naming-story 1.md",
        ref: "174.1.2.crossref-plugin-task.md",
        reason: "not-found",
        candidates: undefined,
      },
      {
        file: "backlog/archive/174.1.graph-and-naming-story 1.md",
        ref: "174.1.3.naming-rules-task.md",
        reason: "not-found",
        candidates: undefined,
      },
      {
        file: "backlog/archive/174.1.graph-and-naming-story 1.md",
        ref: "174.1.4.backlog-lifecycle-rules-task.md",
        reason: "not-found",
        candidates: undefined,
      },
    ]);
  });

  it("keeps archive targets visible and resolves migrated record links", async () => {
    const root = await mkTmpDir("doc-vader-source-relative-record-");
    cleanupDirs.push(root);
    await writeFile(path.join(root, "backlog", "archive", "old.md"), "---\nid: old\nstatus: closed\n---\n");
    await writeFile(path.join(root, "backlog", "audit", "auditing-backlog-report.json"), "{}\n");
    await writeFile(path.join(root, "backlog", "records", "record.md"), "---\nid: record\nstatus: closed\nlinks:\n  related:\n    - '[[../archive/old]]'\n  supporting_reference:\n    - '[[../audit/auditing-backlog-report.json]]'\n---\n");

    const report = await auditBacklog({ rootDir: root, backlogDir: path.join(root, "backlog"), includeArchive: false, format: "json" });
    expect(report.unresolved_wikilinks).toHaveLength(0);
  });

  it("rejects unknown non-extension work-item link keys", async () => {
    const tmp = await mkTmpDir("doc-vader-backlog-link-vocabulary-invalid-");
    cleanupDirs.push(tmp);

    await writeFile(
      path.join(tmp, "10.invalid-link.md"),
      `---\nid: wi-10\ntitle: Invalid Link\ntype: work-item\nsubtype: task\nlifecycle: active\nstatus: ready\npriority: high\nestimated: 1\nlinks:\n  owner_of:\n    - '[[wi-9]]'\n---\n`,
    );

    const report = await auditBacklog({
      backlogDir: tmp,
      rootDir: process.cwd(),
      failOn: "error",
      format: "json",
    });

    expect(report.totals.schema_violations).toBe(1);
    expect(report.schema_violations[0]?.errors.join("\n")).toContain("owner_of");
  });
});
