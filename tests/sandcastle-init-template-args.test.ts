import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  renderSandcastleInitArtifacts,
  sandcastleInitTemplateArgs,
} from "../scripts/sandcastle/init-artifacts.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const artifactPaths = {
  planPrompt: ".sandcastle/plan-prompt.md",
  implementPrompt: ".sandcastle/implement-prompt.md",
  setupDoc: ".sandcastle/SETUP_ISSUE_TRACKER.md",
} as const;
const sandcastleInitPlaceholderPattern = new RegExp(
  `\\{\\{(?:${Object.keys(sandcastleInitTemplateArgs).join("|")})\\}\\}`,
);

function outputPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function requireRenderedArtifact(
  renderedByPath: Map<string, string>,
  relativePath: string,
): string {
  const content = renderedByPath.get(relativePath);
  if (content === undefined) {
    throw new Error(`Missing rendered artifact: ${relativePath}`);
  }
  return content;
}

describe("sandcastle init template args wiring", () => {
  it("renders committed prompt artifacts from dv4sandcastle template args", async () => {
    const rendered = await renderSandcastleInitArtifacts({ rootDir: repoRoot });
    const renderedByPath = new Map(
      rendered.map((artifact) => [artifact.outputRelativePath, artifact.content]),
    );

    const planPrompt = requireRenderedArtifact(renderedByPath, artifactPaths.planPrompt);
    const implementPrompt = requireRenderedArtifact(
      renderedByPath,
      artifactPaths.implementPrompt,
    );
    const setupDoc = requireRenderedArtifact(renderedByPath, artifactPaths.setupDoc);

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

    for (const fragment of [
      sandcastleInitTemplateArgs.ISSUE_TRACKER_TOOLS,
      `${sandcastleInitTemplateArgs.CLOSE_TASK_COMMAND} <task-id> --claim <claim-id> [--payload <json-file>] [--record-type <type>]`,
      "[`docs/how-to/sandcastle-dogfood-task-flow.md`](../docs/how-to/sandcastle-dogfood-task-flow.md)",
      "Treat completed backlog items as history only; the guide above plus these",
      "Do not edit `.sandcastle/plan-prompt.md` or `.sandcastle/implement-prompt.md` directly.",
    ] as const) {
      expect(setupDoc).toContain(fragment);
    }

    for (const content of renderedByPath.values()) {
      expect(content).not.toMatch(sandcastleInitPlaceholderPattern);
    }

    await Promise.all(
      [...renderedByPath.entries()].map(async ([relativePath, content]) => {
        expect(await readFile(outputPath(relativePath), "utf8")).toBe(content);
      }),
    );
  });
});
