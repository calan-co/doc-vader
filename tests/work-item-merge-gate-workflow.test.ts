import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readWorkflow(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("trusted Work-item merge gate workflow", () => {
  it("runs trusted validator code against PR data and API-provided changed paths", () => {
    const workflow = readWorkflow(".github/workflows/work-item-merge-gate.yml");

    for (const fragment of [
      "name: Work-item merge gate",
      "pull_request_target:",
      "      - edited",
      "contents: read",
      "pull-requests: read",
      "ref: ${{ github.event.pull_request.base.sha }}",
      "path: trusted",
      "actions/github-script@v7",
      "pulls.get",
      "currentPullRequest.data.merge_commit_sha",
      "git.getCommit",
      "mergeCommit.parents[0]?.sha !== currentPullRequest.data.base.sha",
      "Pull request merge commit has a stale base; failing closed.",
      "mergeCommit.parents[1]?.sha !== currentPullRequest.data.head.sha",
      "Pull request merge commit is stale; failing closed.",
      "git.getTree",
      "tree_sha: mergeCommit.tree.sha",
      "git.getBlob",
      "Pull request tree is truncated; failing closed.",
      "pulls.listFiles",
      "files.length !== context.payload.pull_request.changed_files",
      "Unable to collect every changed path",
      "previous_filename",
      "DOC_VADER_ROOT: ${{ steps.work-items.outputs.root }}",
      'core.setOutput("path"',
      "DOC_VADER_CHANGED_PATHS_FILE: ${{ steps.changed-files.outputs.path }}",
      "pnpm run backlog:validate:pr",
    ]) {
      expect(workflow).toContain(fragment);
    }
  });

  it("uses a distinct bootstrap check until the trusted workflow is available on the base branch", () => {
    const workflow = readWorkflow(".github/workflows/ci.yml");

    expect(workflow).toContain("work-item-merge-gate-bootstrap:");
    expect(workflow).toContain("name: Work-item merge gate bootstrap");
    expect(workflow).toContain("DOC_VADER_HEAD_SHA: ${{ github.sha }}");
    expect(workflow).toMatch(
      /work-item-merge-gate-bootstrap:[\s\S]*?fetch-depth: 0\n          persist-credentials: false/,
    );
    expect(workflow).not.toContain("name: Work-item merge gate\n");
  });
});

// ponytail: text assertions cover the workflow contract without a GitHub Actions emulator.
describe("Release workflow", () => {
  it("keeps staging on the prerelease path instead of creating a version PR", () => {
    const workflow = readWorkflow(".github/workflows/release.yml");

    expect(workflow).toContain("github.ref_name == 'main'");
    expect(workflow).toContain("github.ref_name == 'staging'");
    expect(workflow).not.toContain("github.ref_name == github.event.repository.default_branch");
  });
});
