const SHORT_FORM_ENTITY_TYPE_SPECIFIERS = new Map<string, string>([
  ["work-item", "wi"],
]);

const LEGACY_WORK_ITEM_PREFIX = /^wi-(.+)$/i;
const CANONICAL_SCOPE_REF_PATTERN = /^([a-z][a-z0-9-]*):(.+)$/i;
const STORAGE_ADAPTER_PATTERN = /^(?:file|path|db|database):/i;

function normalizeEntityTypeSpecifier(specifier: string): string {
  const trimmed = specifier.trim().toLowerCase();
  return SHORT_FORM_ENTITY_TYPE_SPECIFIERS.get(trimmed) ?? trimmed;
}

function normalizeWorkItemStableId(stableId: string): string {
  const trimmed = stableId.trim();
  if (trimmed.length === 0) {
    throw new Error("Provide a canonical Work Item ScopeRef with a stable id.");
  }
  return trimmed.replace(/^wi-/i, "");
}

function isStorageAdapterReference(value: string): boolean {
  return STORAGE_ADAPTER_PATTERN.test(value.trim());
}

export function canonicalizeScopeRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Provide a canonical ScopeRef.");
  }
  if (isStorageAdapterReference(trimmed) || /[\\/]/.test(trimmed)) {
    throw new Error(
      `Provide a canonical ScopeRef, not a storage adapter reference: ${value}`,
    );
  }

  const legacyMatch = trimmed.match(LEGACY_WORK_ITEM_PREFIX);
  if (legacyMatch) {
    return `wi:${normalizeWorkItemStableId(legacyMatch[1] ?? "")}`;
  }

  const canonicalMatch = trimmed.match(CANONICAL_SCOPE_REF_PATTERN);
  if (!canonicalMatch) {
    throw new Error(
      `Provide a canonical ScopeRef in the form <entity-type-specifier>:<stable-id>: ${value}`,
    );
  }

  const [, entityTypeSpecifier, stableId] = canonicalMatch;
  const canonicalEntityTypeSpecifier = normalizeEntityTypeSpecifier(
    entityTypeSpecifier,
  );
  const normalizedStableId =
    canonicalEntityTypeSpecifier === "wi"
      ? normalizeWorkItemStableId(stableId)
      : stableId.trim();
  if (normalizedStableId.length === 0) {
    throw new Error("Provide a canonical ScopeRef with a stable id.");
  }
  return `${canonicalEntityTypeSpecifier}:${normalizedStableId}`;
}

export function canonicalizeWorkItemScopeRef(value: string): string {
  let canonical: string;
  try {
    canonical = canonicalizeScopeRef(value);
  } catch {
    throw new Error(
      `Provide a canonical Work Item ScopeRef, not a storage adapter reference: ${value}`,
    );
  }
  if (!canonical.startsWith("wi:")) {
    throw new Error(
      `Provide a canonical Work Item ScopeRef, not ${canonical}.`,
    );
  }
  return canonical;
}
