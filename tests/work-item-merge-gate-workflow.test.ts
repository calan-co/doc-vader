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
      "ref: refs/pull/${{ github.event.pull_request.number }}/merge",
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

  it("does not publish a PR-local Work-item merge gate check", () => {
    const workflow = readWorkflow(".github/workflows/ci.yml");

    expect(workflow).not.toContain("work-item-merge-gate:");
    expect(workflow).not.toContain("Work-item merge gate");
  });
});
