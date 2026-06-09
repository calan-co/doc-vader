import { Linter, Fixer } from "../interfaces/ruleset";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { DIATAXIS_CATEGORIES, stripLeadingDiataxis } from "./classify.js";
import { classifyDiataxisPlacement } from "./classify.js";
import { list } from "../docs/utils.js";

// Diataxis fixer implementation
export class DiataxisFixer
  implements Fixer<{ docsDir: string; dryRun?: boolean }, number>
{
  async fix({
    docsDir,
    dryRun = false,
  }: {
    docsDir: string;
    dryRun?: boolean;
  }): Promise<number> {
    return await fix({ docsDir, dryRun });
  }
}

// Diataxis linter implementation example
export class DiataxisLinter implements Linter<string | object, string | null> {
  lint(input: string | object): string | null {
    // Example: use validateDiataxisFolder for linting
    if (typeof input === "string") {
      // Assume input is a file path for demonstration
      // TODO: Accept diataxis as argument or extract from input
      return null;
    }
    return null;
  }
}

// Validate that a file's folder matches its diataxis classification
export function validateDiataxisFolder(
  filePath: string,
  diataxis: string
): string | null {
  if (!diataxis || !DIATAXIS_CATEGORIES.includes(diataxis) || !filePath)
    return null;
  const classification = classifyDiataxisPlacement(filePath, diataxis);
  if (classification.matches || !classification.docsFolder) return null;
  return `Diataxis folder mismatch: file under "${classification.docsFolder}" but subtype is "${diataxis}"`;
}

export async function fix({
  docsDir,
  dryRun = false,
}: {
  docsDir: string;
  dryRun?: boolean;
}): Promise<number> {
  const files = await list(docsDir);
  if (files.length === 0) {
    console.log("No markdown files under docs/.");
    return 0;
  }
  const moves: Array<{ from: string; to: string }> = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const { data } = matter(raw);
    const diataxis = data?.classification?.diataxis;
    if (!diataxis || !DIATAXIS_CATEGORIES.includes(diataxis)) continue;
    const relFromDocs = path.relative(docsDir, file);
    const firstSeg = relFromDocs.split(path.sep)[0];
    if (firstSeg === diataxis) continue;
    const tail = stripLeadingDiataxis(relFromDocs);
    const target = path.join(docsDir, diataxis, tail);
    moves.push({ from: file, to: target });
  }
  if (moves.length === 0) {
    console.log("No moves necessary.");
    return 0;
  }
  for (const m of moves) {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Move: ${path.relative(
        process.cwd(),
        m.from
      )} -> ${path.relative(process.cwd(), m.to)}`
    );
    if (!dryRun) {
      await fs.mkdir(path.dirname(m.to), { recursive: true });
      await fs.rename(m.from, m.to);
    }
  }
  console.log(`\n${dryRun ? "Planned" : "Completed"} ${moves.length} move(s).`);
  return moves.length;
}
