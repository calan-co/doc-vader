import type { MarkdownChecklistDefinition } from "./qualifiers.js";

export interface DocumentTypePackChecklistManifest {
  readonly schemaVersion: "doc-vader/document-type-pack/v1";
  readonly namespace: string;
  readonly documentTypes: readonly unknown[];
  readonly checklistDefinitions?: readonly MarkdownChecklistDefinition[];
}

/**
 * Resolve checklist definitions contributed by a document-type-pack manifest.
 * Pack loading belongs above this seam; Work Management consumes only the
 * resolved pack contract and never interprets template headings directly.
 */
export function resolveChecklistDefinitions(
  manifest: DocumentTypePackChecklistManifest,
): readonly MarkdownChecklistDefinition[] {
  const definitions = manifest.checklistDefinitions ?? [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id || !definition.heading) {
      throw new Error("Checklist definitions require non-empty id and heading.");
    }
    if (seen.has(definition.id)) {
      throw new Error(`Duplicate checklist definition id '${definition.id}'.`);
    }
    seen.add(definition.id);
  }
  return definitions;
}

/** The built-in Work Management document-type pack's resolved manifest. */
export const workManagementDocumentTypePack = {
  schemaVersion: "doc-vader/document-type-pack/v1",
  namespace: "doc-vader.work-management",
  documentTypes: [{ type: "work-item", metadataSchema: "schemas/work-management/frontmatter/work-item.json" }],
  checklistDefinitions: [
    { id: "tasks", heading: "Tasks" },
    { id: "acceptance-criteria", heading: "Acceptance Criteria" },
  ],
} as const satisfies DocumentTypePackChecklistManifest;

/** Resolve the built-in pack at the same seam used by future installed packs. */
export function resolveWorkManagementChecklistDefinitions(): readonly MarkdownChecklistDefinition[] {
  return resolveChecklistDefinitions(workManagementDocumentTypePack);
}
