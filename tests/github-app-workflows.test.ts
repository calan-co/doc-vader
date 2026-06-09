import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readWorkflow(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("doc-vader GitHub App workflow wiring", () => {
  it("keeps the sweep workflow on the doc-vader app token path", () => {
    const sweep = readWorkflow(".github/workflows/backlog-sweep.yml");

    expect(sweep).toContain("actions/create-github-app-token@v1");
    expect(sweep).toContain("default: 'doc-vader[bot]'");
    expect(sweep).toContain(
      "token: ${{ steps.app-token.outputs.token || github.token }}",
    );
    expect(sweep).toContain(
      "GH_TOKEN: ${{ steps.app-token.outputs.token || github.token }}",
    );
  });

  it("keeps the reusable ingest workflows authenticated as doc-vader[bot]", () => {
    const pullRequest = readWorkflow(
      ".github/workflows/backlog-ingest-pull-request.yml",
    );
    const workflowRun = readWorkflow(
      ".github/workflows/backlog-ingest-workflow-run.yml",
    );

    for (const workflow of [pullRequest, workflowRun]) {
      expect(workflow).toContain("actions/create-github-app-token@v1");
      expect(workflow).toContain("default: 'doc-vader[bot]'");
      expect(workflow).toContain(
        "token: ${{ steps.app-token.outputs.token || github.token }}",
      );
    }
  });

  it("passes the app credentials through the top-level automation workflow", () => {
    const automation = readWorkflow(".github/workflows/backlog-automation.yml");

    expect(automation).toContain("app-id: ${{ vars.DOC_VADER_APP_ID }}");
    expect(automation).toContain(
      "app-private-key: ${{ secrets.DOC_VADER_PRIVATE_KEY }}",
    );
    expect(automation).toContain("doc-vader/.github/workflows/backlog-sweep.yml@v1");
    expect(automation).toContain(
      "doc-vader/.github/workflows/backlog-ingest-pull-request.yml@v1",
    );
    expect(automation).toContain(
      "doc-vader/.github/workflows/backlog-ingest-workflow-run.yml@v1",
    );
  });
});
