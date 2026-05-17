export interface RequiredFieldRule {
  field: string;
  values?: string[];
}

export const DEFAULT_WORK_ITEM_MATCH_PATTERNS = ["work-item:"];
export const DEFAULT_PULL_REQUEST_PATH = "links.pull_requests";
export const DEFAULT_REQUIRED_CANDIDATE_FIELDS: RequiredFieldRule[] = [
  { field: "actual" },
  { field: "status", values: ["ready-for-review", "closed"] },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return [...new Set(
    raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
}

export function normalizeWorkItemMatchPatterns(raw: unknown): string[] {
  const normalized = normalizeStringArray(raw);
  return normalized.length > 0
    ? normalized
    : [...DEFAULT_WORK_ITEM_MATCH_PATTERNS];
}

export function normalizePullRequestPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_PULL_REQUEST_PATH;
  }
  return raw.trim();
}

export function normalizeRequiredFieldRules(raw: unknown): RequiredFieldRule[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_REQUIRED_CANDIDATE_FIELDS.map((entry) => ({ ...entry }));
  }

  const normalized: RequiredFieldRule[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ field: entry.trim() });
      continue;
    }

    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const entryRecord = entry as Record<string, unknown>;

    const field =
      typeof entryRecord.field === "string"
        ? entryRecord.field.trim()
        : "";
    if (field.length === 0) {
      continue;
    }

    const values = normalizeStringArray(entryRecord.values);
    normalized.push(values.length > 0 ? { field, values } : { field });
  }

  if (normalized.length === 0) {
    return DEFAULT_REQUIRED_CANDIDATE_FIELDS.map((entry) => ({ ...entry }));
  }

  return normalized;
}

export function getValueByPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let cursor: unknown = source;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

export function extractStringValuesAtPath(
  source: Record<string, unknown>,
  path: string,
): string[] {
  const direct = getValueByPath(source, path);

  if (typeof direct === "string") {
    const trimmed = direct.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (Array.isArray(direct)) {
    const values = direct
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length > 0) {
      return [...new Set(values)];
    }
  }

  const segments = path.split(".");
  if (segments.length < 2) {
    return [];
  }

  const leaf = segments[segments.length - 1] ?? "";
  const parentPath = segments.slice(0, -1).join(".");
  const parent = getValueByPath(source, parentPath);

  if (!Array.isArray(parent)) {
    return [];
  }

  const singularLeaf = leaf.endsWith("s") ? leaf.slice(0, -1) : leaf;
  const collected: string[] = [];

  for (const entry of parent) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    for (const key of [leaf, singularLeaf]) {
      const value = record[key];
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        collected.push(trimmed);
      }
    }
  }

  return [...new Set(collected)];
}

export function extractSubjectTokens(
  input: string,
  patterns?: string[],
): string[] {
  const normalizedPatterns = normalizeWorkItemMatchPatterns(patterns);
  const matches = new Set<string>();

  for (const pattern of normalizedPatterns) {
    const re = new RegExp(
      `\\b${escapeRegex(pattern)}[a-z0-9]+(?:-[a-z0-9]+)*\\b`,
      "gi",
    );
    for (const match of input.match(re) ?? []) {
      matches.add(match.toLowerCase());
    }
  }

  return [...matches];
}

export function matchesWorkItemId(id: string, patterns?: string[]): boolean {
  const normalizedPatterns = normalizeWorkItemMatchPatterns(patterns);
  const normalizedId = id.toLowerCase();

  return normalizedPatterns.some((pattern) =>
    normalizedId.startsWith(pattern.toLowerCase()),
  );
}
