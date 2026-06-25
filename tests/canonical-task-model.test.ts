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
        },
        "runtime": {
          "markdownReady": true,
          "executionReady": true,
          "ready": true,
          "sourceDisagreement": false
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
    expect(prompt).toContain("# Sandcastle Work Item: wi-100");
    expect(prompt).toContain("Implement `Canonical Task Model`");
    expect(prompt).toContain("Use the canonical work item JSON as the source of truth.");
    expect(prompt).toContain(
      "docs/how-to/sandcastle-dogfood-task-flow.md",
    );
    expect(prompt).toContain("Initialization and registry mapping live in");
    for (const fragment of [
      "Claim this work item before execution with `dv work claim <task-id> --holder <holder> --json`",
      "`dv lock create --claim <claim-token> <path...>`",
      "`dv lock rm --claim <claim-token> <path...>`",
      "`dv claim release <claim-token> --outcome conflict`",
      "`dv work recover <task-id>`",
      "do not treat Git hooks or prompt instructions as deterministic enforcement.",
    ]) {
      expect(prompt).toContain(fragment);
    }
  });

  it("documents the deferred claim-bound artifact reservation contract", async () => {
    const canonicalTask = await loadCanonicalTask({
      rootDir: repoRoot,
      taskId: "60344",
    });
    const deferredContractFragments = [
      "Artifact refs resolve through the deferred graph model instead of widening the current file/document atomicity rule",
      "Future artifact reservation commands remain follow-on surface area",
      "Multi-ref reservation adds are all-or-none",
      "Structured rejection reasons should distinguish outside-graph, conflict, repeated, and dry-run failures",
      "Future validation should cover inside-scope, outside-scope, conflicting, repeated, multi-ref atomic, remove, and dry-run cases",
    ] as const;

    const [human, prompt] = await Promise.all([
      renderHumanTask({ rootDir: repoRoot, task: canonicalTask }),
      renderSandcastlePrompt({ rootDir: repoRoot, task: canonicalTask }),
    ]);

    expect(canonicalTask.body.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Deferred Contract" }),
      ]),
    );
    for (const fragment of deferredContractFragments) {
      expect(human).toContain(fragment);
      expect(prompt).toContain(fragment);
    }
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
