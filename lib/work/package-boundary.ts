import path from "node:path";

export interface RelativeImportBoundaryViolation {
  filePath: string;
  specifier: string;
  resolvedPath: string;
}

export interface RelativeImportBoundaryCheckOptions {
  repoRoot: string;
  boundaryRoot?: string;
  allowedInternalPathPrefixes?: readonly string[];
  filePath: string;
  sourceText: string;
}

const MODULE_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const IGNORED_RANGE_PATTERN =
  /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

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

function isWithinRoot(rootDir: string, resolvedPath: string): boolean {
  return !resolvesOutsideRoot(rootDir, resolvedPath);
}

function resolvesWithinAnyRoot(
  allowedRoots: readonly string[],
  resolvedPath: string,
): boolean {
  return allowedRoots.some((allowedRoot) => isWithinRoot(allowedRoot, resolvedPath));
}

export function collectModuleSpecifiers(sourceText: string): string[] {
  const ignoredRanges = collectIgnoredRanges(sourceText);
  const startsInIgnoredRange = (index: number): boolean =>
    ignoredRanges.some((range) => index >= range.start && index < range.end);

  return [...sourceText.matchAll(MODULE_SPECIFIER_PATTERN)]
    .filter((match) => !startsInIgnoredRange(match.index))
    .map(getMatchedModuleSpecifier)
    .filter((specifier): specifier is string => specifier !== undefined);
}

function collectIgnoredRanges(sourceText: string): Array<{ start: number; end: number }> {
  const ignoredRanges = [...sourceText.matchAll(IGNORED_RANGE_PATTERN)].map(
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );

  function skipQuoted(index: number, quote: string): number {
    let cursor = index + 1;
    while (cursor < sourceText.length) {
      if (sourceText[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (sourceText[cursor] === quote) {
        return cursor + 1;
      }
      cursor += 1;
    }
    return sourceText.length;
  }

  function templateEnd(index: number): number {
    let cursor = index + 1;
    while (cursor < sourceText.length) {
      if (sourceText[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (sourceText[cursor] === "`") {
        return cursor + 1;
      }
      if (sourceText[cursor] === "$" && sourceText[cursor + 1] === "{") {
        cursor = expressionEnd(cursor + 2) + 1;
        continue;
      }
      cursor += 1;
    }
    return sourceText.length;
  }

  function expressionEnd(index: number): number {
    let depth = 1;
    let cursor = index;
    while (cursor < sourceText.length) {
      const char = sourceText[cursor];
      const next = sourceText[cursor + 1];
      if (char === "/" && next === "/") {
        const newline = sourceText.indexOf("\n", cursor + 2);
        cursor = newline === -1 ? sourceText.length : newline + 1;
        continue;
      }
      if (char === "/" && next === "*") {
        const close = sourceText.indexOf("*/", cursor + 2);
        cursor = close === -1 ? sourceText.length : close + 2;
        continue;
      }
      if (char === "\"" || char === "'") {
        cursor = skipQuoted(cursor, char);
        continue;
      }
      if (char === "`") {
        cursor = templateEnd(cursor);
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return cursor;
        }
      }
      cursor += 1;
    }
    return sourceText.length;
  }

  let cursor = 0;
  while (cursor < sourceText.length) {
    if (sourceText[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let rawStart = cursor;
    cursor += 1;
    while (cursor < sourceText.length) {
      if (sourceText[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (sourceText[cursor] === "`") {
        ignoredRanges.push({ start: rawStart, end: cursor + 1 });
        cursor += 1;
        break;
      }
      if (sourceText[cursor] === "$" && sourceText[cursor + 1] === "{") {
        ignoredRanges.push({ start: rawStart, end: cursor });
        cursor = expressionEnd(cursor + 2) + 1;
        rawStart = cursor;
        continue;
      }
      cursor += 1;
    }
  }

  return ignoredRanges;
}

export function findRelativeImportBoundaryViolations(
  options: RelativeImportBoundaryCheckOptions,
): RelativeImportBoundaryViolation[] {
  const repoRoot = path.resolve(options.repoRoot);
  const boundaryRoot = path.resolve(options.boundaryRoot ?? repoRoot);
  const importerDir = path.dirname(path.resolve(options.filePath));
  const allowedInternalRoots = (
    options.allowedInternalPathPrefixes ?? []
  ).map((value) => path.resolve(repoRoot, value));

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
    .filter((entry) => {
      const escapesBoundaryRoot = resolvesOutsideRoot(boundaryRoot, entry.resolvedPath);
      if (!escapesBoundaryRoot) {
        return false;
      }

      const escapesRepoRoot = resolvesOutsideRoot(repoRoot, entry.resolvedPath);
      if (escapesRepoRoot) {
        return true;
      }

      return !resolvesWithinAnyRoot(allowedInternalRoots, entry.resolvedPath);
    });
}
