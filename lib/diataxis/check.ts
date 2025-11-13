import { Checker } from "../interfaces/ruleset";

// Diataxis checker implementation example
export class DiataxisChecker implements Checker<string | object, boolean> {
  check(input: string | object): boolean {
    // TODO: Implement actual check logic
    return true;
  }
}
// Diataxis checking logic
export function checkDiataxis(input: string | object): object {
  // TODO: If Diataxis has check logic, move from scripts/docs-diataxis.ts or validate-docs.ts here
  return {};
}
