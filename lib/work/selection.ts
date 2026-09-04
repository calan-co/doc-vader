import { selectReadyTasks, type SelectReadyTasksOptions } from "../task/ready.js";

/** Stable capability name for publisher-owned Work selection. */
export const PUBLISHED_WORK_SELECTION_CAPABILITY = "publisher-work-selection/v1" as const;

export const PUBLISHED_WORK_NON_SELECTION_CODES = [
  "NOT_FOUND",
  "NOT_READY",
  "AMBIGUOUS",
  "NOT_AUTHORIZED",
  "INVALID_REQUEST",
  "UNSUPPORTED_CAPABILITY",
  "PUBLISHER_UNAVAILABLE",
] as const;

export type PublishedWorkNonSelectionCode =
  (typeof PUBLISHED_WORK_NON_SELECTION_CODES)[number];

export type PublishedWorkSelectionJson =
  | null
  | boolean
  | number
  | string
  | PublishedWorkSelectionJson[]
  | { [key: string]: PublishedWorkSelectionJson };

export interface PublishedWorkSelectionRequest {
  capability: typeof PUBLISHED_WORK_SELECTION_CAPABILITY;
  request: {
    workItemId: string;
    /** Passed to the publisher but intentionally absent from the response contract. */
    invocationContext: unknown;
  };
}

export type PublishedWorkSelectionResponse = {
  /** Echoes the invoked capability, including an unsupported requested version. */
  capability: string;
  outcome:
    | { kind: "selected"; workItemId: string }
    | { kind: "not-selected"; code: PublishedWorkNonSelectionCode };
  /** JSON-safe, publisher-owned evidence for downstream reconstruction. */
  decisionArtifact: {
    invokedCommand: string;
    requestedWorkItemId: string | null;
    /** Opaque base64-encoded JSON publisher result; consumers must not decode semantics. */
    sourceResult: string;
  };
};

export type DecodedPublishedWorkSelection = {
  /** Invoked publisher capability/version retained for consumer evidence. */
  capability: typeof PUBLISHED_WORK_SELECTION_CAPABILITY;
  /** Opaque publisher evidence retained without exposing readiness semantics. */
  decisionArtifact: PublishedWorkSelectionResponse["decisionArtifact"];
} & (
  | { kind: "selected"; workItemId: string }
  | { kind: "not-selected"; code: PublishedWorkNonSelectionCode }
);

/** Publisher-owned execution options; consumers never supply readiness results. */
export interface PublishedWorkSelectionOptions extends Pick<SelectReadyTasksOptions, "rootDir" | "backlogDir"> {
  /** Optional publisher policy hook for invocation authorization. */
  authorize?: (request: PublishedWorkSelectionRequest) => boolean | Promise<boolean>;
  /** Exact transport invocation retained as publisher evidence. */
  invokedCommand?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SHELL_TOKEN = "(?:-|[A-Za-z0-9_./:-]+|'(?:[^']|'\"'\"')*')";
const PUBLISHED_WORK_SELECTION_COMMAND = new RegExp(
  `^dv work select --request ${SHELL_TOKEN}(?: --backlog-dir ${SHELL_TOKEN})?(?: --json)?$`,
);

/**
 * Render a command-evidence token using POSIX single-quote escaping. This is a
 * serialization grammar for durable evidence, not a command executor.
 */
function quoteCommandToken(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Render canonical, shell-safe publisher selection command evidence. */
export function formatPublishedWorkSelectionCommand(options: {
  request: string;
  backlogDir?: string;
  json?: boolean;
}): string {
  return `dv work select --request ${quoteCommandToken(options.request)}`
    + (options.backlogDir === undefined ? "" : ` --backlog-dir ${quoteCommandToken(options.backlogDir)}`)
    + (options.json ? " --json" : "");
}

function isCanonicalJsonBase64(value: unknown): value is string {
  if (typeof value !== "string"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) return false;
    JSON.parse(bytes.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

function isArtifact(
  value: unknown,
): value is PublishedWorkSelectionResponse["decisionArtifact"] {
  return isRecord(value)
    && typeof value.invokedCommand === "string"
    && PUBLISHED_WORK_SELECTION_COMMAND.test(value.invokedCommand)
    && (typeof value.requestedWorkItemId === "string" || value.requestedWorkItemId === null)
    && isCanonicalJsonBase64(value.sourceResult);
}

function isRequest(value: unknown): value is PublishedWorkSelectionRequest {
  return isRecord(value)
    && value.capability === PUBLISHED_WORK_SELECTION_CAPABILITY
    && isRecord(value.request)
    && typeof value.request.workItemId === "string"
    && value.request.workItemId.length > 0
    && "invocationContext" in value.request;
}

function invokedCapability(request: unknown): string {
  return isRecord(request) && typeof request.capability === "string"
    ? request.capability
    : PUBLISHED_WORK_SELECTION_CAPABILITY;
}

function opaqueSourceResult(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function artifact(
  invokedCommand: string,
  requestedWorkItemId: string | null,
  sourceResult: unknown,
): PublishedWorkSelectionResponse["decisionArtifact"] {
  return {
    invokedCommand,
    requestedWorkItemId,
    sourceResult: opaqueSourceResult(sourceResult),
  };
}

function response(
  capability: string,
  outcome: PublishedWorkSelectionResponse["outcome"],
  decisionArtifact: PublishedWorkSelectionResponse["decisionArtifact"],
): PublishedWorkSelectionResponse {
  return { capability, outcome, decisionArtifact };
}

/** Discover supported publisher capabilities and their explicit response mapping. */
export function discoverPublishedWorkSelectionCapabilities() {
  return {
    schemaVersion: "publisher-work-selection-discovery/v1",
    capabilities: [PUBLISHED_WORK_SELECTION_CAPABILITY],
    versionMappings: [{
      requestedCapability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      responseCapability: PUBLISHED_WORK_SELECTION_CAPABILITY,
    }],
  };
}

/**
 * Execute publisher-owned readiness selection. Consumers supply only the
 * versioned request; task-ready results remain internal to Doc-Vader.
 */
export async function selectPublishedWork(
  request: unknown,
  options: PublishedWorkSelectionOptions = {},
): Promise<PublishedWorkSelectionResponse> {
  const capability = invokedCapability(request);
  const command = options.invokedCommand ?? "dv work select --request - --json";
  if (!isRecord(request) || request.capability !== PUBLISHED_WORK_SELECTION_CAPABILITY) {
    return response(capability, { kind: "not-selected", code: "UNSUPPORTED_CAPABILITY" }, artifact(command, null, null));
  }
  if (!isRequest(request)) {
    return response(capability, { kind: "not-selected", code: "INVALID_REQUEST" }, artifact(command, null, null));
  }
  try {
    if (options.authorize && !(await options.authorize(request))) {
      return response(capability, { kind: "not-selected", code: "NOT_AUTHORIZED" }, artifact(command, request.request.workItemId, null));
    }
    const ready = await selectReadyTasks({ rootDir: options.rootDir, backlogDir: options.backlogDir });
    const evidence = artifact(command, request.request.workItemId, ready);
    const selected = ready.candidates.filter((candidate) => candidate.id === request.request.workItemId);
    if (selected.length === 1) return response(capability, { kind: "selected", workItemId: selected[0]!.id }, evidence);
    if (selected.length > 1) return response(capability, { kind: "not-selected", code: "AMBIGUOUS" }, evidence);
    if (ready.exclusions.some((candidate) => candidate.id === request.request.workItemId)) {
      return response(capability, { kind: "not-selected", code: "NOT_READY" }, evidence);
    }
    return response(capability, { kind: "not-selected", code: "NOT_FOUND" }, evidence);
  } catch {
    return response(capability, { kind: "not-selected", code: "PUBLISHER_UNAVAILABLE" }, artifact(command, request.request.workItemId, null));
  }
}

/**
 * Strict consumer decoder. Any transport defect throws so the consumer must
 * fail closed before effects; it never receives readiness metadata.
 */
export function decodePublishedWorkSelectionResponse(
  request: PublishedWorkSelectionRequest,
  value: unknown,
): DecodedPublishedWorkSelection {
  if (!isRequest(request)) throw new Error("Invalid publisher work-selection request.");
  if (!isRecord(value)
    || value.capability !== PUBLISHED_WORK_SELECTION_CAPABILITY
    || !isArtifact(value.decisionArtifact)
    || value.decisionArtifact.requestedWorkItemId !== request.request.workItemId
    || !isRecord(value.outcome)) {
    throw new Error("Malformed publisher work-selection response.");
  }
  if (value.outcome.kind === "selected") {
    if (typeof value.outcome.workItemId !== "string" || value.outcome.workItemId !== request.request.workItemId) {
      throw new Error("Publisher selected an identity other than the requested Work Item.");
    }
    return {
      kind: "selected",
      workItemId: value.outcome.workItemId,
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      decisionArtifact: value.decisionArtifact,
    };
  }
  if (value.outcome.kind === "not-selected"
    && typeof value.outcome.code === "string"
    && (PUBLISHED_WORK_NON_SELECTION_CODES as readonly string[]).includes(value.outcome.code)) {
    return {
      kind: "not-selected",
      code: value.outcome.code as PublishedWorkNonSelectionCode,
      capability: PUBLISHED_WORK_SELECTION_CAPABILITY,
      decisionArtifact: value.decisionArtifact,
    };
  }
  throw new Error("Malformed publisher work-selection outcome.");
}
