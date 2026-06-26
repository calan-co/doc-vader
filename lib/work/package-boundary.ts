import path from "node:path";

export interface RelativeImportBoundaryViolation {
  filePath: string;
  specifier: string;
  resolvedPath: string;
}

const MODULE_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function isRelativeModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith(".");
}

function isPathOutsideRoot(rootDir: string, targetPath: string): boolean {
  const relativePath = path.relative(rootDir, targetPath);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}

export function collectModuleSpecifiers(sourceText: string): string[] {
  return [...sourceText.matchAll(MODULE_SPECIFIER_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((specifier) => specifier.length > 0);
}

export function findRelativeImportBoundaryViolations(options: {
  repoRoot: string;
  filePath: string;
  sourceText: string;
}): RelativeImportBoundaryViolation[] {
  const repoRoot = path.resolve(options.repoRoot);
  const importerDir = path.dirname(path.resolve(options.filePath));

  return collectModuleSpecifiers(options.sourceText)
    .filter(isRelativeModuleSpecifier)
    .map((specifier) => ({
      filePath: options.filePath,
      specifier,
      resolvedPath: path.resolve(importerDir, specifier),
    }))
    .filter((entry) => isPathOutsideRoot(repoRoot, entry.resolvedPath));
}
