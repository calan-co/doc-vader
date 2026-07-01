import path from "node:path";

export interface RelativeImportBoundaryViolation {
  filePath: string;
  specifier: string;
  resolvedPath: string;
}

export interface RelativeImportBoundaryCheckOptions {
  repoRoot: string;
  filePath: string;
  sourceText: string;
}

const MODULE_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const IGNORED_RANGE_PATTERN =
  /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

function isRelativeModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith(".");
}

function getMatchedModuleSpecifier(match: RegExpMatchArray): string | undefined {
  return match[1] ?? match[2] ?? match[3];
}

function resolvesOutsideRoot(rootDir: string, resolvedPath: string): boolean {
  const relativePath = path.relative(rootDir, resolvedPath);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

export function collectModuleSpecifiers(sourceText: string): string[] {
  const ignoredRanges = [...sourceText.matchAll(IGNORED_RANGE_PATTERN)].map(
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  const startsInIgnoredRange = (index: number): boolean =>
    ignoredRanges.some((range) => index >= range.start && index < range.end);

  return [...sourceText.matchAll(MODULE_SPECIFIER_PATTERN)]
    .filter((match) => !startsInIgnoredRange(match.index))
    .map(getMatchedModuleSpecifier)
    .filter((specifier): specifier is string => specifier !== undefined);
}

export function findRelativeImportBoundaryViolations(
  options: RelativeImportBoundaryCheckOptions,
): RelativeImportBoundaryViolation[] {
  const repoRoot = path.resolve(options.repoRoot);
  const importerDir = path.dirname(path.resolve(options.filePath));

  return collectModuleSpecifiers(options.sourceText)
    .filter(isRelativeModuleSpecifier)
    .map((specifier): RelativeImportBoundaryViolation => {
      const resolvedPath = path.resolve(importerDir, specifier);

      return {
        filePath: options.filePath,
        specifier,
        resolvedPath,
      };
    })
    .filter((entry) => resolvesOutsideRoot(repoRoot, entry.resolvedPath));
}
