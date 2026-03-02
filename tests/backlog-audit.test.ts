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
});
