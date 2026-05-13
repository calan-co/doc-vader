/**
 * BacklogAutomationProvider Interface
 *
 * Abstracts vendor-specific operations for backlog automation.
 * Enables multi-forge support (GitHub, GitLab, Bitbucket, etc.)
 * and testability by allowing mock implementations.
 */

export interface PRIdentity {
  /** Repository owner/org */
  owner: string;
  /** Repository name */
  repo: string;
  /** PR number */
  number: number;
  /** Full reference for display/debugging */
  reference: string;
}

export interface WorkflowRunIdentity {
  /** Workflow run ID from forge */
  id: string;
  /** Workflow file name */
  workflowName: string;
  /** Workflow run conclusion (success, failure, etc.) */
  conclusion: string | null;
  /** Full reference for display/debugging */
  reference: string;
}

export interface FetchedPRMetadata {
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR state: open, closed, merged */
  state: "open" | "closed" | "merged";
  /** PR merge status */
  merged: boolean;
  /** Optional merge commit SHA if merged */
  mergeCommitSha?: string;
  /** PR URL */
  url: string;
}

export interface ParsedWorkflowPayload {
  /** Raw payload object */
  raw: Record<string, unknown>;
  /** Extracted workflow run identity */
  workflowRunIdentity: WorkflowRunIdentity | null;
  /** Extracted PR identity (if available) */
  prIdentity: PRIdentity | null;
}

/**
 * BacklogAutomationProvider defines vendor-agnostic operations
 * for backlog automation tasks.
 */
export interface BacklogAutomationProvider {
  /**
   * Get the vendor name (e.g., "github", "gitlab").
   */
  vendor(): string;

  /**
   * Parse a raw webhook payload into standardized format.
   */
  parsePayload(raw: Record<string, unknown>): ParsedWorkflowPayload;

  /**
   * Extract PR identity from a parsed workflow payload.
   * Returns null if no PR is associated with the payload.
   */
  extractPRIdentity(payload: ParsedWorkflowPayload): PRIdentity | null;

  /**
   * Extract workflow run identity from a parsed workflow payload.
   * Returns null if the payload doesn't contain workflow run information.
   */
  extractWorkflowRunIdentity(payload: ParsedWorkflowPayload): WorkflowRunIdentity | null;

  /**
   * Normalize a PR reference string into a PRIdentity.
   * Handles formats like "owner/repo#123" or "https://github.com/owner/repo/pull/123".
   * Returns null if the reference cannot be parsed.
   */
  normalizePRReference(ref: string): PRIdentity | null;

  /**
   * Fetch detailed PR metadata from the forge.
   * Used by LinkedPullRequestsResolver for validation and enrichment.
   * Throws if the PR cannot be fetched (network error, not found, etc.)
   *
   * @param identity - PR identity to fetch
   * @returns Fetched metadata
   */
  fetchPRMetadata(identity: PRIdentity): Promise<FetchedPRMetadata>;

  /**
   * Check if authentication is available for forge API calls.
   * Used to determine if fetchPRMetadata is safe to call.
   */
  isAuthenticated(): boolean;
}
