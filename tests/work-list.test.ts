import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as projectionModule from "../lib/work/projection.js";
import { listWorkModels } from "../lib/work/index.js";

async function mkTmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-work-list-"));
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.mkdir(path.join(root, ".doc-vader"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".doc-vader/backlog-consumer.json"),
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
  return root;
}

async function writeTask(root: string, fileName: string, frontmatter: string): Promise<void> {
  await fs.writeFile(
    path.join(root, "backlog", fileName),
    `---\n${frontmatter.trim()}\n---\n`,
    "utf8",
  );
}

describe("graph-backed work list", () => {
  it("projects the work graph before hydrating listed work items", async () => {
    const root = await mkTmpRoot();
    try {
      await writeTask(
        root,
        "100-backlog-item.md",
        `id: wi-100
title: Backlog Item
type: work-item
lifecycle: active
status: ready`,
      );

      const projectSpy = vi.spyOn(projectionModule, "projectWorkGraph");
      const tasks = await listWorkModels({ rootDir: root });

      expect(projectSpy).toHaveBeenCalledTimes(1);
      expect(tasks.map((task) => task.id)).toEqual(["wi-100"]);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
