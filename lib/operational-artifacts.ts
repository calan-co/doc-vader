import path from "node:path";

export type OperationalArtifactReason = "runtime-authority" | "agent-local";

export type OperationalArtifactClassification =
  | {
      kind: "operational";
      path: string;
      reason: OperationalArtifactReason;
    }
  | {
      kind: "unknown";
      path: string;
      reason: "unclassified-path" | "invalid-path";
    };

function normalizeRepositoryPath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return normalized;
}

/**
 * This intentionally narrow allowlist identifies local state that is neither a
 * governed deliverable nor a normal claim-lock target. All other paths remain
 * unclassified until their caller assigns a governed classification.
 */
export function classifyOperationalArtifact(
  value: string,
): OperationalArtifactClassification {
  const normalized = normalizeRepositoryPath(value);
  if (!normalized) {
    return { kind: "unknown", path: value, reason: "invalid-path" };
  }
  if (normalized === ".doc-vader/runtime" || normalized.startsWith(".doc-vader/runtime/")) {
    return { kind: "operational", path: normalized, reason: "runtime-authority" };
  }
  if (normalized === ".pi" || normalized.startsWith(".pi/")) {
    return { kind: "operational", path: normalized, reason: "agent-local" };
  }
  return { kind: "unknown", path: normalized, reason: "unclassified-path" };
}

export function isOperationalArtifact(value: string): boolean {
  return classifyOperationalArtifact(value).kind === "operational";
}
