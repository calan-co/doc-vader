import { Checker } from "../interfaces/ruleset";
import matter from "gray-matter";
import { promises as fs } from "node:fs";
import { validateDiataxisFolder } from "../../scripts/docs-diataxis.js";

// Docs checker implementation example
export default class DocsChecker
  implements
    Checker<
      { filePath: string; content: string },
      { valid: boolean; error?: string }
    >
{
  check(input: { filePath: string; content: string }): {
    valid: boolean;
    error?: string;
  } {
    const { filePath, content } = input;
    const fm = matter(content);
    const diataxis = fm.data?.classification?.diataxis;
    const err = validateDiataxisFolder(filePath, diataxis);
    return { valid: !err, error: err ?? undefined };
  }
}

// Helper: async file loader and sync check
export async function loadAndCheckDocs(
  filePath: string
): Promise<{ file: string; valid: boolean; error?: string }> {
  const content = await fs.readFile(filePath, "utf8");
  const checker = new DocsChecker();
  const result = checker.check({ filePath, content });
  return { file: filePath, valid: result.valid, error: result.error };
}
