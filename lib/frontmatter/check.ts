import { Checker } from "../interfaces/ruleset";

// Frontmatter checker implementation example
export class FrontmatterChecker implements Checker<string | object, boolean> {
  check(input: string | object): boolean {
    // TODO: Implement actual check logic
    return true;
  }
}

// Frontmatter checking logic
export function checkFrontmatter(input: string | object): object {
  // TODO: Move check logic from scripts/validate-frontmatter.ts here if distinct from lint
  return {};
}

export function checkSchemaDirective(
  raw: string,
  expectedFile: string
): string | null {
  // moved from utils.ts
  const frontmatterBlock = raw.startsWith("---")
    ? raw.replace(/^---\s*/, "").replace(/\s*---\s*$/, "")
    : raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const innerLines = frontmatterBlock.split(/\r?\n/);
  const firstNonEmpty = innerLines.find((l) => l.trim().length > 0) || "";
  const schemaMatch = firstNonEmpty.match(
    /^#\s*yaml-language-server:\s*\$schema\s*=\s*(.+)\s*$/
  );
  if (!schemaMatch) {
    return 'Missing first-line schema directive: "# yaml-language-server: $schema=./schemas/<schema>.json"';
  }
  const provided = schemaMatch[1].trim().replace(/"|'|`/g, "");
  if (
    !provided.endsWith(`/${expectedFile}`) &&
    !provided.endsWith(`\\${expectedFile}`) &&
    !provided.endsWith(expectedFile)
  ) {
    return `Schema directive filename mismatch: expected to end with "${expectedFile}", got "${provided}"`;
  }
  return null;
}
