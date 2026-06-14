import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubBacklogAutomationProvider } from "../lib/backlog/providers/github.js";
import type { ParsedWorkflowPayload } from "../lib/backlog/provider.js";

describe("GitHubBacklogAutomationProvider", () => {
  let provider: GitHubBacklogAutomationProvider;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new GitHubBacklogAutomationProvider("test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("vendor", () => {
    it("returns 'github'", () => {
      expect(provider.vendor()).toBe("github");
    });
  });

  describe("isAuthenticated", () => {
    it("returns true when token is provided", () => {
      const providerWithToken = new GitHubBacklogAutomationProvider("test-token");
      expect(providerWithToken.isAuthenticated()).toBe(true);
    });

    it("returns false when no token", () => {
      const originalToken = process.env.GITHUB_TOKEN;
      try {
        delete process.env.GITHUB_TOKEN;
        const providerNoToken = new GitHubBacklogAutomationProvider();
        expect(providerNoToken.isAuthenticated()).toBe(false);
      } finally {
        if (originalToken === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = originalToken;
        }
      }
    });
  });

  describe("parsePayload", () => {
    it("extracts PR identity from pull_request event", () => {
      const payload = {
        pull_request: {
          number: 123,
          head: {
            repo: {
              owner: { login: "owner" },
              name: "repo",
            },
          },
          base: {
            repo: {
              owner: { login: "owner" },
              name: "repo",
            },
          },
        },
      };

      const result = provider.parsePayload(payload);

      expect(result.prIdentity).toEqual({
        owner: "owner",
        repo: "repo",
        number: 123,
        reference: "owner/repo#123",
      });
    });

    it("extracts workflow run from workflow_run event", () => {
      const payload = {
        workflow_run: {
          id: 456,
          name: "CI",
          conclusion: "success",
          html_url: "https://github.com/owner/repo/actions/runs/456",
        },
      };

      const result = provider.parsePayload(payload);

      expect(result.workflowRunIdentity).toEqual({
        id: "456",
        workflowName: "CI",
        conclusion: "success",
        reference: "https://github.com/owner/repo/actions/runs/456",
      });
    });
  });

  describe("normalizePRReference", () => {
    it("parses owner/repo#number format", () => {
      const result = provider.normalizePRReference("owner/repo#123");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        number: 123,
        reference: "owner/repo#123",
      });
    });

    it("parses GitHub URL format", () => {
      const result = provider.normalizePRReference(
        "https://github.com/owner/repo/pull/456",
      );

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        number: 456,
        reference: "owner/repo#456",
      });
    });

    it("returns null for invalid format", () => {
      const result = provider.normalizePRReference("invalid-format");

      expect(result).toBeNull();
    });
  });

  describe("fetchPRMetadata", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("throws when not authenticated or invalid token", async () => {
      const noAuthProvider = new GitHubBacklogAutomationProvider("");
      await expect(
        noAuthProvider.fetchPRMetadata({
          owner: "owner",
          repo: "repo",
          number: 123,
          reference: "owner/repo#123",
        }),
      ).rejects.toThrow();
    });

    it("fetches PR metadata from GitHub API", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          number: 123,
          title: "Fix bug",
          state: "closed",
          merged: true,
          merge_commit_sha: "abc123",
          html_url: "https://github.com/owner/repo/pull/123",
        }),
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await provider.fetchPRMetadata({
        owner: "owner",
        repo: "repo",
        number: 123,
        reference: "owner/repo#123",
      });

      expect(result).toEqual({
        number: 123,
        title: "Fix bug",
        state: "closed",
        merged: true,
        mergeCommitSha: "abc123",
        url: "https://github.com/owner/repo/pull/123",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/pulls/123",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    });

    it("throws on 404 response", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(
        provider.fetchPRMetadata({
          owner: "owner",
          repo: "repo",
          number: 999,
          reference: "owner/repo#999",
        }),
      ).rejects.toThrow("PR not found");
    });
  });
});
