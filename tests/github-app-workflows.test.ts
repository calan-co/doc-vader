import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const appTokenWorkflowFragments = [
  "actions/create-github-app-token@v1",
  "default: 'doc-vader[bot]'",
  "token: ${{ steps.app-token.outputs.token || github.token }}",
] as const;
const reusableIngestWorkflowPaths = [
  ".github/workflows/backlog-ingest-pull-request.yml",
  ".github/workflows/backlog-ingest-workflow-run.yml",
] as const;
const automationWorkflowFragments = [
  "app-id: ${{ vars.DOC_VADER_APP_ID }}",
  "app-private-key: ${{ secrets.DOC_VADER_PRIVATE_KEY }}",
  "doc-vader/.github/workflows/backlog-sweep.yml@v1",
  "doc-vader/.github/workflows/backlog-ingest-pull-request.yml@v1",
  "doc-vader/.github/workflows/backlog-ingest-workflow-run.yml@v1",
] as const;

function readWorkflow(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectWorkflowToContain(
  workflow: string,
  fragments: readonly string[],
) {
  for (const fragment of fragments) {
    expect(workflow).toContain(fragment);
  }
}

describe("doc-vader GitHub App workflow wiring", () => {
  it("keeps the sweep workflow on the doc-vader app token path", () => {
    const sweep = readWorkflow(".github/workflows/backlog-sweep.yml");

    expectWorkflowToContain(sweep, appTokenWorkflowFragments);
    expect(sweep).toContain(
      "GH_TOKEN: ${{ steps.app-token.outputs.token || github.token }}",
    );
    expect(sweep).not.toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  });

  describe.each(reusableIngestWorkflowPaths)(
    "keeps %s authenticated as doc-vader[bot]",
    (workflowPath) => {
      it("uses the app token path", () => {
        expectWorkflowToContain(
          readWorkflow(workflowPath),
          appTokenWorkflowFragments,
        );
      });
    },
  );

  it("passes the app credentials through the top-level automation workflow", () => {
    const automation = readWorkflow(".github/workflows/backlog-automation.yml");
    expectWorkflowToContain(automation, automationWorkflowFragments);
  });
});
