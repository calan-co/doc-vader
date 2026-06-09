import { Classifier } from "../interfaces/ruleset";
import path from "node:path";

export interface DiataxisPlacementClassification {
  filePath: string;
  subtype: string;
  docsFolder: string | null;
  expectedFolder: string | null;
  matches: boolean;
  message: string | null;
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function extractClassificationInput(input: string | object): {
  filePath: string;
  subtype: string;
} {
  if (typeof input === "string") {
    return { filePath: input, subtype: "" };
  }

  const candidate = input as {
    filePath?: unknown;
    path?: unknown;
    subtype?: unknown;
  };

  const filePath =
    typeof candidate.filePath === "string"
      ? candidate.filePath
      : typeof candidate.path === "string"
        ? candidate.path
        : "";
  const subtype =
    typeof candidate.subtype === "string" ? candidate.subtype : "";

  return { filePath, subtype };
}

export function classifyDiataxisPlacement(
  filePath: string,
  subtype: string,
): DiataxisPlacementClassification {
  const normalizedFilePath = normalizeFilePath(filePath);
  const segments = normalizedFilePath.split("/").filter(Boolean);
  const docsIndex = segments.lastIndexOf("docs");
  const docsFolder =
    docsIndex === -1 || docsIndex >= segments.length - 1
      ? null
      : segments[docsIndex + 1];
  const expectedFolder = subtype || null;
  const matches = Boolean(
    docsFolder && expectedFolder && docsFolder === expectedFolder,
  );

  return {
    filePath,
    subtype,
    docsFolder,
    expectedFolder,
    matches,
    message:
      docsFolder && expectedFolder && !matches
        ? `Diataxis folder mismatch: file under "${docsFolder}" but subtype is "${subtype}"`
        : null,
  };
}

export class DiataxisClassifier implements Classifier<string | object, object> {
  classify(input: string | object): object {
    const { filePath, subtype } = extractClassificationInput(input);
    return classifyDiataxisPlacement(filePath, subtype);
  }
}

export const DIATAXIS_CATEGORIES = [
  "tutorial",
  "how-to",
  "reference",
  "explanation",
];

export function stripLeadingDiataxis(relFromDocs: string): string {
  const parts = relFromDocs.split(path.sep);
  if (parts.length && DIATAXIS_CATEGORIES.includes(parts[0])) {
    return parts.slice(1).join(path.sep);
  }
  return relFromDocs;
}
