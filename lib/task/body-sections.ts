import type { CanonicalTaskBodySection } from "./canonical.js";

const RELATIONSHIP_SECTION_TITLE = "relationships";

function normalizeSectionTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function omitRelationshipBodySections(
  sections: readonly CanonicalTaskBodySection[],
): CanonicalTaskBodySection[] {
  return sections.filter(
    (section) =>
      normalizeSectionTitle(section.title) !== RELATIONSHIP_SECTION_TITLE,
  );
}
