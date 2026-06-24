export type ClaimReleaseContext = "no-commit" | "post-merge";

export interface ClaimReleaseDetails {
  taskId: string;
  branch?: string;
}

export function formatClaimReleaseMessage(
  details: ClaimReleaseDetails,
  context: ClaimReleaseContext,
): string {
  const branchPart = details.branch ? ` on branch ${details.branch}` : "";
  const messagePrefix = `Released claim for ${details.taskId}${branchPart}`;

  switch (context) {
    case "no-commit":
      return `${messagePrefix} because no branch commits exist.`;
    case "post-merge":
      return `${messagePrefix} after host task completion.`;
  }
}

export function formatGenericClaimReleaseMessage(
  details: ClaimReleaseDetails,
): string {
  const branchPart = details.branch ? ` on branch ${details.branch}` : "";
  return `Released claim for ${details.taskId}${branchPart}.`;
}
