#!/usr/bin/env node
/**
 * fix-docs-diataxis.ts
 * Moves docs to correct Diataxis folders based on frontmatter classification.diataxis.
 * Usage: node scripts/fix-docs-diataxis.ts [--dry-run]
 */
import path from "node:path";
import { DiataxisFixer } from "../lib/diataxis/lint.js";

const docsDir = path.resolve(process.cwd(), "docs");
const dryRun = process.argv.includes("--dry-run");

(async function main() {
  try {
    const fixer = new DiataxisFixer();
    const count = await fixer.fix({ docsDir, dryRun });
    if (count === 0) {
      process.exit(0);
    } else if (dryRun) {
      process.exit(0);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Diataxis fixer crashed:", err);
    process.exit(1);
  }
})();
