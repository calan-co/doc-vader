import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderSandcastleInitArtifacts,
  sandcastleInitTemplateArgs,
} from "../scripts/sandcastle/init-artifacts.js";

const repoRoot = process.cwd();

function outputPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe("sandcastle init template args wiring", () => {
  it("renders committed prompt artifacts from dv4sandcastle template args", async () => {
    const rendered = await renderSandcastleInitArtifacts({ rootDir: repoRoot });
    const renderedByPath = new Map(
      rendered.map((artifact) => [artifact.outputRelativePath, artifact.content]),
    );

    const planPrompt = renderedByPath.get(".sandcastle/plan-prompt.md");
    const implementPrompt = renderedByPath.get(".sandcastle/implement-prompt.md");
    const setupDoc = renderedByPath.get(".sandcastle/SETUP_ISSUE_TRACKER.md");

    expect(planPrompt).toContain(`!\`${sandcastleInitTemplateArgs.LIST_TASKS_COMMAND}\``);
    expect(planPrompt).not.toContain(".sandcastle/list-ready-issues.mjs");

    expect(implementPrompt).toContain(
      `${sandcastleInitTemplateArgs.VIEW_TASK_COMMAND} {{TASK_ID}}`,
    );
    expect(implementPrompt).toContain(
      `${sandcastleInitTemplateArgs.PROMPT_TASK_COMMAND} {{TASK_ID}}`,
    );
    expect(implementPrompt).toContain(
      `${sandcastleInitTemplateArgs.CLAIM_TASK_COMMAND} {{TASK_ID}}`,
    );
    expect(implementPrompt).toContain(
      `${sandcastleInitTemplateArgs.RECOVER_TASK_COMMAND} {{TASK_ID}}`,
    );
    expect(implementPrompt).toContain(
      `${sandcastleInitTemplateArgs.CLOSE_TASK_COMMAND} {{TASK_ID}} --claim <claim-id>`,
    );
    expect(implementPrompt).not.toContain(".sandcastle/view-issue.mjs");
    expect(implementPrompt).not.toContain(
      "Set frontmatter `status: completed`.",
    );
    expect(implementPrompt).not.toContain(
      "Mark every completed item in `## Tasks` with `[x]`.",
    );
    expect(implementPrompt).toContain(
      "Do not edit backlog status/checklists by hand as the normal completion path.",
    );

    expect(setupDoc).toContain(sandcastleInitTemplateArgs.ISSUE_TRACKER_TOOLS);
    expect(setupDoc).toContain(
      "Do not edit `.sandcastle/plan-prompt.md` or `.sandcastle/implement-prompt.md` directly.",
    );

    for (const [relativePath, content] of renderedByPath) {
      expect(await readFile(outputPath(relativePath), "utf8")).toBe(content);
    }
  });
});
