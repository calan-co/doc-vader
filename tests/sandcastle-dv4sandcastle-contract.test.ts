import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sandcastleInitTemplateArgs } from "../scripts/sandcastle/init-artifacts.js";
import { sandcastleAdapterContract } from "../scripts/sandcastle/dv4sandcastle-contract.js";

describe("dv4sandcastle contract", () => {
  it("uses checklist and Gate terminology in every generated Sandcastle prompt", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    for (const template of [
      "../templates/reference/task/sandcastle-prompt.md.tpl",
      "../scripts/sandcastle/templates/implement-prompt.md.tpl",
    ]) {
      const prompt = readFileSync(path.resolve(testDirectory, template), "utf8");
      expect(prompt).toContain("checklist");
      expect(prompt).toContain("Gate");
      expect(prompt).not.toContain("Temporary Checklist and Completion Protocol");
      expect(prompt).not.toContain("acceptance checkboxes");
    }
  });

  it("captures command names, required arguments, and output expectations", () => {
    expect(sandcastleAdapterContract).toEqual({
      schemaVersion: "dv4sandcastle-contract/v1",
      commands: [
        {
          name: "list",
          usage: "dv4sandcastle list",
          requiredArgs: [],
          optionalFlags: [],
          output: "json",
          expectation: "schemaVersion=dv4sandcastle-list/v1",
        },
        {
          name: "view",
          usage: "dv4sandcastle view <task-id>",
          requiredArgs: ["task-id"],
          optionalFlags: [],
          output: "json",
          expectation: "canonical work item JSON from dv work <id> show",
        },
        {
          name: "prompt",
          usage: "dv4sandcastle prompt <task-id>",
          requiredArgs: ["task-id"],
          optionalFlags: [],
          output: "text",
          expectation: "implementation prompt text from dv work <id> prompt",
        },
        {
          name: "claim-task",
          usage: "dv4sandcastle claim-task <task-id> [claim flags]",
          requiredArgs: ["task-id"],
          optionalFlags: ["--holder", "--branch", "--json"],
          output: "json",
          expectation: "runtime claim result from the Sandcastle adapter",
        },
        {
          name: "recover-task",
          usage: "dv4sandcastle recover-task <task-id> [recover flags]",
          requiredArgs: ["task-id"],
          optionalFlags: ["--branch", "--force", "--json"],
          output: "json",
          expectation: "runtime recovery result from the Sandcastle adapter",
        },
        {
          name: "record-task",
          usage: "dv4sandcastle record-task [record flags]",
          requiredArgs: [],
          optionalFlags: ["--claim", "--type", "--payload", "--json"],
          output: "json",
          expectation: "work record result from the Sandcastle adapter",
        },
        {
          name: "close-task",
          usage: "dv4sandcastle close-task <task-id> [close flags]",
          requiredArgs: ["task-id"],
          optionalFlags: ["--claim", "--payload", "--record-type"],
          output: "json",
          expectation: "repository transition and release result from the Sandcastle adapter",
        },
        {
          name: "lock-status",
          usage: "dv4sandcastle lock-status [lock flags]",
          requiredArgs: [],
          optionalFlags: ["--claim", "--json"],
          output: "json",
          expectation: "runtime claim and lock status",
        },
      ],
    });

    expect(sandcastleInitTemplateArgs).toMatchObject({
      LIST_TASKS_COMMAND: expect.stringContaining("dv4sandcastle.ts\" list"),
      VIEW_TASK_COMMAND: expect.stringContaining("dv4sandcastle.ts\" view"),
      PROMPT_TASK_COMMAND: expect.stringContaining("dv4sandcastle.ts\" prompt"),
      CLAIM_TASK_COMMAND: expect.stringContaining("dv4sandcastle.ts\" claim-task"),
      LOCK_STATUS_COMMAND: expect.stringContaining(
        "dv4sandcastle.ts\" lock-status",
      ),
      RECORD_TASK_COMMAND: expect.stringContaining("dv4sandcastle.ts\" record-task"),
      RECOVER_TASK_COMMAND: expect.stringContaining(
        "dv4sandcastle.ts\" recover-task",
      ),
      CLOSE_TASK_COMMAND: expect.stringContaining("dv4sandcastle.ts\" close-task"),
    });

  });
});
