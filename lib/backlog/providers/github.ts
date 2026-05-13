/**
 * GitHubBacklogAutomationProvider
 *
 * Implementation of BacklogAutomationProvider for GitHub webhooks and API.
 * Handles parsing GitHub workflow payloads and fetching PR metadata.
 */

import type {
  BacklogAutomationProvider,
  ParsedWorkflowPayload,
  PRIdentity,
  WorkflowRunIdentity,
  FetchedPRMetadata,
} from "../provider.js";

export class GitHubBacklogAutomationProvider implements BacklogAutomationProvider {
  private authToken?: string;

  constructor(authToken?: string) {
    this.authToken = authToken || process.env.GITHUB_TOKEN;
  }

  vendor(): string {
    return "github";
  }

  isAuthenticated(): boolean {
    return !!this.authToken;
  }

  parsePayload(raw: Record<string, unknown>): ParsedWorkflowPayload {
    const workflowRunIdentity = this.extractWorkflowRunIdentityFromPayload(raw);
    const prIdentity = this.extractPRIdentityFromPayload(raw);

    return {
      raw,
      workflowRunIdentity,
      prIdentity,
    };
  }

  private extractWorkflowRunIdentityFromPayload(
    raw: Record<string, unknown>,
  ): WorkflowRunIdentity | null {
    // GitHub Actions: workflow_run event
    const workflowRun = raw.workflow_run as Record<string, unknown> | undefined;
    if (!workflowRun) {
      return null;
    }

    const id = workflowRun.id;
    const name = workflowRun.name;
    const conclusion = workflowRun.conclusion;
    const htmlUrl = workflowRun.html_url;

    if (
      typeof id !== "number" ||
      typeof name !== "string" ||
      typeof htmlUrl !== "string"
    ) {
      return null;
    }

    return {
      id: String(id),
      workflowName: name,
      conclusion: typeof conclusion === "string" ? conclusion : null,
      reference: htmlUrl,
    };
  }

  private extractPRIdentityFromPayload(
    raw: Record<string, unknown>,
  ): PRIdentity | null {
    // Try pull_request event first
    const pullRequest = raw.pull_request as Record<string, unknown> | undefined;
    if (pullRequest) {
      const repo = pullRequest.head as Record<string, unknown> | undefined;
      const baseRepo = pullRequest.base as Record<string, unknown> | undefined;

      if (repo && baseRepo) {
        const repoObj = repo.repo as Record<string, unknown> | undefined;
        const baseRepoObj = baseRepo.repo as Record<string, unknown> | undefined;

        if (repoObj && baseRepoObj) {
          const owner = baseRepoObj.owner as Record<string, unknown> | undefined;
          const number = pullRequest.number;

          if (owner && typeof owner.login === "string" && typeof number === "number") {
            const repoName = baseRepoObj.name;
            if (typeof repoName === "string") {
              return {
                owner: owner.login,
                repo: repoName,
                number,
                reference: `${owner.login}/${repoName}#${number}`,
              };
            }
          }
        }
      }
    }

    // Try workflow_run -> pull_requests (GitHub doesn't include direct PR data)
    const workflowRun = raw.workflow_run as Record<string, unknown> | undefined;
    if (workflowRun) {
      const repo = workflowRun.repository as Record<string, unknown> | undefined;
      const pullRequests = workflowRun.pull_requests as unknown[];

      if (repo && Array.isArray(pullRequests) && pullRequests.length > 0) {
        const pr = pullRequests[0] as Record<string, unknown> | undefined;
        if (pr) {
          const owner = repo.owner as Record<string, unknown> | undefined;
          const number = pr.number;
          const repoName = repo.name;

          if (
            owner &&
            typeof owner.login === "string" &&
            typeof number === "number" &&
            typeof repoName === "string"
          ) {
            return {
              owner: owner.login,
              repo: repoName,
              number,
              reference: `${owner.login}/${repoName}#${number}`,
            };
          }
        }
      }
    }

    return null;
  }

  extractPRIdentity(payload: ParsedWorkflowPayload): PRIdentity | null {
    return payload.prIdentity;
  }

  extractWorkflowRunIdentity(payload: ParsedWorkflowPayload): WorkflowRunIdentity | null {
    return payload.workflowRunIdentity;
  }

  normalizePRReference(ref: string): PRIdentity | null {
    // Format: owner/repo#123
    const match = ref.match(/^(.+?)\/(.+?)#(\d+)$/);
    if (match) {
      const [, owner, repo, numberStr] = match;
      const number = parseInt(numberStr, 10);
      return {
        owner,
        repo,
        number,
        reference: ref,
      };
    }

    // Format: https://github.com/owner/repo/pull/123
    const urlMatch = ref.match(
      /https:\/\/github\.com\/(.+?)\/(.+?)\/pull\/(\d+)/,
    );
    if (urlMatch) {
      const [, owner, repo, numberStr] = urlMatch;
      const number = parseInt(numberStr, 10);
      return {
        owner,
        repo,
        number,
        reference: `${owner}/${repo}#${number}`,
      };
    }

    return null;
  }

  async fetchPRMetadata(identity: PRIdentity): Promise<FetchedPRMetadata> {
    if (!this.authToken) {
      throw new Error("GitHub authentication token required to fetch PR metadata");
    }

    const url = `https://api.github.com/repos/${identity.owner}/${identity.repo}/pulls/${identity.number}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`PR not found: ${identity.reference}`);
        }
        throw new Error(
          `Failed to fetch PR metadata: ${response.status} ${response.statusText}`,
        );
      }

      const pr = (await response.json()) as Record<string, unknown>;

      return {
        number: identity.number,
        title: typeof pr.title === "string" ? pr.title : "Unknown",
        state: this.normalizePRState(pr.state),
        merged: typeof pr.merged === "boolean" ? pr.merged : false,
        mergeCommitSha:
          typeof pr.merge_commit_sha === "string" ? pr.merge_commit_sha : undefined,
        url: typeof pr.html_url === "string" ? pr.html_url : identity.reference,
      };
    } catch (err) {
      throw new Error(
        `Failed to fetch PR metadata for ${identity.reference}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private normalizePRState(
    state: unknown,
  ): "open" | "closed" | "merged" {
    if (state === "open") return "open";
    if (state === "closed") return "closed";
    // GitHub API returns "closed" for merged PRs; check merged field separately
    return "closed";
  }
}
