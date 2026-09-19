"use strict";

/**
 * Node 20-compatible boundary validator for publisher-work-selection/v1.
 * It intentionally has no Doc-Vader package dependency and never interprets
 * non-selection codes as readiness semantics.
 */
const CAPABILITY = "publisher-work-selection/v1";
const CODES = new Set([
  "NOT_FOUND",
  "NOT_READY",
  "AMBIGUOUS",
  "NOT_AUTHORIZED",
  "INVALID_REQUEST",
  "UNSUPPORTED_CAPABILITY",
  "PUBLISHER_UNAVAILABLE",
]);
const SHELL_TOKEN = "(?:-|[A-Za-z0-9_./:-]+|'(?:[^']|'\"'\"')*')";
const COMMAND = new RegExp(
  `^dv work select (${SHELL_TOKEN}) --request ${SHELL_TOKEN}(?: --backlog-dir ${SHELL_TOKEN})?(?: --json)?$`,
);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function commandWorkItemId(command) {
  const match = COMMAND.exec(command);
  if (!match) return null;
  const token = match[1];
  return token.startsWith("'")
    ? token.slice(1, -1).replaceAll("'\"'\"'", "'")
    : token;
}

/** Validate opaque evidence as canonical base64-encoded JSON without interpreting it. */
function canonicalJsonBase64(value) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    return false;
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) return false;
    const text = bytes.toString("utf8");
    if (!bytes.equals(Buffer.from(text, "utf8"))) return false;
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function decode(request, value) {
  if (
    !record(request) ||
    request.capability !== CAPABILITY ||
    !record(request.request) ||
    typeof request.request.workItemId !== "string" ||
    request.request.workItemId.length === 0 ||
    !Object.prototype.hasOwnProperty.call(request.request, "invocationContext")
  ) {
    throw new Error("Invalid publisher work-selection request.");
  }
  if (
    !record(value) ||
    value.capability !== CAPABILITY ||
    !record(value.outcome) ||
    !record(value.decisionArtifact) ||
    typeof value.decisionArtifact.invokedCommand !== "string" ||
    !COMMAND.test(value.decisionArtifact.invokedCommand) ||
    commandWorkItemId(value.decisionArtifact.invokedCommand) !==
      request.request.workItemId ||
    !canonicalJsonBase64(value.decisionArtifact.sourceResult) ||
    value.decisionArtifact.requestedWorkItemId !== request.request.workItemId
  ) {
    throw new Error("Malformed publisher work-selection response.");
  }
  if (value.outcome.kind === "selected") {
    if (
      typeof value.outcome.workItemId !== "string" ||
      value.outcome.workItemId !== request.request.workItemId
    ) {
      throw new Error(
        "Publisher selected an identity other than the requested Work Item.",
      );
    }
    return {
      kind: "selected",
      workItemId: value.outcome.workItemId,
      capability: value.capability,
      decisionArtifact: value.decisionArtifact,
    };
  }
  if (
    value.outcome.kind === "not-selected" &&
    typeof value.outcome.code === "string" &&
    CODES.has(value.outcome.code)
  ) {
    return {
      kind: "not-selected",
      code: value.outcome.code,
      capability: value.capability,
      decisionArtifact: value.decisionArtifact,
    };
  }
  throw new Error("Malformed publisher work-selection outcome.");
}

module.exports = { CAPABILITY, decode };
