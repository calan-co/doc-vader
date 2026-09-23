import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readWorkflow(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("trusted Work-item merge gate workflow", () => {
  it("runs trusted validator code against PR data and API-provided changed paths", () => {
    const workflow = readWorkflow(".github/workflows/work-item-merge-gate.yml");

    for (const fragment of [
      "name: Work-item merge gate",
      "pull_request_target:",
      "contents: read",
      "pull-requests: read",
      "ref: ${{ github.event.pull_request.base.sha }}",
      "path: trusted",
      "ref: ${{ github.event.pull_request.head.sha }}",
      "path: pr-data",
      "actions/github-script@v7",
      "pulls.listFiles",
      "files.length !== context.payload.pull_request.changed_files",
      "Unable to collect every changed path",
      "previous_filename",
      "DOC_VADER_ROOT: ${{ github.workspace }}/pr-data",
      'core.setOutput("path"',
      "DOC_VADER_CHANGED_PATHS_FILE: ${{ steps.changed-files.outputs.path }}",
      "pnpm run backlog:validate:pr",
    ]) {
      expect(workflow).toContain(fragment);
    }
  });

  it("keeps the PR-local gate only as the documented bootstrap", () => {
    const workflow = readWorkflow(".github/workflows/ci.yml");

    expect(workflow).toContain("work-item-merge-gate:");
    expect(workflow).toContain("bootstrap PR #96");
  });
});
