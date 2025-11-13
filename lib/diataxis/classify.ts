import { Classifier } from "../interfaces/ruleset";
import path from "node:path";

// Diataxis classifier implementation example
export class DiataxisClassifier implements Classifier<string | object, object> {
  classify(input: string | object): object {
    // TODO: Implement actual classification logic
    return {};
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
