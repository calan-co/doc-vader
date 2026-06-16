import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadCanonicalTask,
  renderHumanTask,
  renderSandcastlePrompt,
  stableTaskJson,
  TaskModelError,
} from "../lib/task/canonical.js";

const tempDirs: string[] = [];
const repoRoot = process.cwd();

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

async function mkRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-task-"));
  tempDirs.push(root);
  return root;
}

async function writeWorkItem(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function exampleWorkItem(id = "wi-100"): string {
  return `---
id: ${id}
title: Canonical Task Model
type: work-item
subtype: story
lifecycle: active
status: ready
status_reason: auto
priority: critical
$schema: schemas/work-management/frontmatter/work-item.json
$content_schema: schemas/work-management/content/work-item.json
$template: templates/reference/work-management/work-item.md.tpl
links:
  depends_on:
    - '[[wi-099]]'
tags:
  - sandcastle
  - afk
---

## Parent

[Parent PRD](../docs/example.md)

## What to build

Load one work item into canonical task JSON and render prompts from it.

## Acceptance Criteria

- [ ] JSON includes stable task identity.
- [x] Prompt rendering reuses the same model.

## Blocked by

None.
`;
}

async function expectTaskError(
  action: () => Promise<unknown>,
  code: string,
): Promise<TaskModelError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskModelError);
    const taskError = error as TaskModelError;
    expect(taskError.code).toBe(code);
    expect(taskError.toJSON()).toMatchObject({
      ok: false,
      error: {
        code,
      },
    });
    return taskError;
  }
  throw new Error(`Expected task error ${code}`);
}

describe("canonical task model", () => {
  it("loads stable JSON for one work item", async () => {
    const root = await mkRoot();
    await writeWorkItem(root, "backlog/100-canonical-task-model.md", exampleWorkItem());

    const task = await loadCanonicalTask({
      rootDir: root,
      taskId: "100",
    });

    expect(stableTaskJson(task)).toMatchInlineSnapshot(`
      "{
        "schemaVersion": "task-model/v1",
        "id": "wi-100",
        "title": "Canonical Task Model",
        "filePath": "backlog/100-canonical-task-model.md",
        "status": "ready",
        "lifecycle": "active",
        "tags": [
          "afk",
          "sandcastle"
        ],
        "dependencies": [
          {
            "type": "depends_on",
            "target": "[[wi-099]]"
          }
        ],
        "body": {
          "sections": [
            {
              "title": "Parent",
              "level": 2,
              "content": "[Parent PRD](../docs/example.md)"
            },
            {
              "title": "What to build",
              "level": 2,
              "content": "Load one work item into canonical task JSON and render prompts from it."
            },
            {
              "title": "Acceptance Criteria",
              "level": 2,
              "content": "- [ ] JSON includes stable task identity.\\n- [x] Prompt rendering reuses the same model."
            },
            {
              "title": "Blocked by",
              "level": 2,
              "content": "None."
            }
          ]
        },
        "acceptanceCriteria": [
          {
            "text": "JSON includes stable task identity.",
            "done": false
          },
          {
            "text": "Prompt rendering reuses the same model.",
            "done": true
          }
        ],
        "validation": {
          "type": "work-item",
          "subtype": "story",
          "priority": "critical",
          "statusReason": "auto",
          "schema": "schemas/work-management/frontmatter/work-item.json",
          "contentSchema": "schemas/work-management/content/work-item.json",
          "template": "templates/reference/work-management/work-item.md.tpl",
          "links": {
            "depends_on": [
              "[[wi-099]]"
            ]
          },
          "archived": false
        }
      }
      "
    `);
  });

  it("renders human and Sandcastle prompts from the same task JSON", async () => {
    const root = await mkRoot();
    await writeWorkItem(root, "backlog/100-canonical-task-model.md", exampleWorkItem());
    const task = await loadCanonicalTask({ rootDir: root, taskId: "wi-100" });

    const [human, prompt] = await Promise.all([
      renderHumanTask({ rootDir: repoRoot, task }),
      renderSandcastlePrompt({ rootDir: repoRoot, task }),
    ]);

    expect(human).toContain("# Canonical Task Model");
    expect(human).toContain("- File: `backlog/100-canonical-task-model.md`");
    expect(human).toContain("- JSON includes stable task identity.");
    expect(prompt).toContain("# Sandcastle Task: wi-100");
    expect(prompt).toContain("Implement `Canonical Task Model`");
    expect(prompt).toContain("Use the canonical task JSON as the source of truth.");
  });

  it("supports no-drift reuse by rendering an already loaded model", async () => {
    const root = await mkRoot();
    await writeWorkItem(root, "backlog/100-canonical-task-model.md", exampleWorkItem());
    const task = await loadCanonicalTask({ rootDir: root, taskId: "100" });
    await fs.rm(path.join(root, "backlog"), { recursive: true, force: true });

    const prompt = await renderSandcastlePrompt({ rootDir: repoRoot, task });

    expect(prompt).toContain("backlog/100-canonical-task-model.md");
    expect(prompt).toContain("Load one work item into canonical task JSON");
  });

  it("fails closed for missing, ambiguous, archived, and invalid task ids", async () => {
    const root = await mkRoot();
    await writeWorkItem(root, "backlog/100-a.md", exampleWorkItem("wi-100"));
    await writeWorkItem(root, "backlog/100-b.md", exampleWorkItem("wi-100"));
    await writeWorkItem(root, "backlog/archive/200-archived.md", exampleWorkItem("wi-200"));
    await writeWorkItem(
      root,
      "backlog/300-invalid.md",
      `---
id: wi-300
title: Invalid Task
type: document
lifecycle: active
status: ready
---

## Acceptance Criteria

- [ ] Should not load.
`,
    );

    await expectTaskError(
      () => loadCanonicalTask({ rootDir: root, taskId: "../100" }),
      "TASK_ID_INVALID",
    );
    await expectTaskError(
      () => loadCanonicalTask({ rootDir: root, taskId: "wi-404" }),
      "TASK_NOT_FOUND",
    );
    await expectTaskError(
      () => loadCanonicalTask({ rootDir: root, taskId: "100" }),
      "TASK_AMBIGUOUS",
    );
    await expectTaskError(
      () => loadCanonicalTask({ rootDir: root, taskId: "200" }),
      "TASK_ARCHIVED",
    );
    await expectTaskError(
      () => loadCanonicalTask({ rootDir: root, taskId: "300" }),
      "TASK_INVALID",
    );
  });
});
