import path from "node:path";
import { promises as fs } from "node:fs";
import {
  normalizeGovernance,
  loadFileFrontmatter,
  buildEffectiveRules,
  CATEGORY_MAP,
} from "../governance/normalize.js";

export interface DetectResult {
  file: string;
  profiles: Array<{
    name: string;
    mode?: string;
    version?: string;
    notes?: string;
    category?: string;
    sourceForm: string;
  }>;
  priorityOrder?: string[];
  reconciliation?: any;
}

export async function listAvailable() {
  // Static list derived from CATEGORY_MAP keys
  return Object.entries(CATEGORY_MAP).map(([name, category]) => ({
    name,
    category,
  }));
}

export async function detect(targetPath: string): Promise<DetectResult[]> {
  const stat = await fs.stat(targetPath);
  const results: DetectResult[] = [];
  if (stat.isDirectory()) {
    const entries = await fs.readdir(targetPath);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const file = path.join(targetPath, entry);
      const r = await detectFile(file);
      results.push(r);
    }
  } else {
    results.push(await detectFile(targetPath));
  }
  return results;
}

async function detectFile(file: string): Promise<DetectResult> {
  const fm = await loadFileFrontmatter(file);
  const governanceRaw = fm["governance"];
  const canonical = normalizeGovernance(governanceRaw);
  if (!canonical) {
    return {
      file,
      profiles: [],
      priorityOrder: undefined,
      reconciliation: undefined,
    };
  }
  const effective = buildEffectiveRules(canonical);
  return {
    file,
    profiles: effective.profiles,
    priorityOrder: effective.priorityOrder,
    reconciliation: effective.reconciliation,
  };
}

export async function effectiveRules(file: string) {
  const fm = await loadFileFrontmatter(file);
  const canonical = normalizeGovernance(fm["governance"]);
  if (!canonical) return { file, message: "No governance section" };
  return buildEffectiveRules(canonical);
}

export async function reconcile(
  file: string,
  options: { strategy?: string; dryRun?: boolean }
) {
  const fm = await loadFileFrontmatter(file);
  const canonical = normalizeGovernance(fm["governance"]);
  if (!canonical)
    return { file, message: "No governance section to reconcile" };
  // Placeholder: strategy engine not yet implemented
  return {
    file,
    appliedStrategy:
      options.strategy || canonical.reconciliation?.defaultStrategy || "prompt",
    dryRun: !!options.dryRun,
    conflicts: [],
    plan: "(placeholder) conflict analysis to be implemented",
  };
}

export async function migrate(docsDir: string, write: boolean) {
  // Placeholder: search legacy governanceProfiles/reconciliation in files and transform
  const entries = await fs.readdir(docsDir);
  const touched: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const file = path.join(docsDir, entry);
    const raw = await fs.readFile(file, "utf8");
    if (/governanceProfiles:/i.test(raw)) {
      touched.push(file);
      // Real migration would parse & rewrite; omitted for now.
    }
  }
  return {
    docsDir,
    writeAttempted: write,
    migratedFiles: touched,
    message: "Migration logic not yet implemented",
  };
}

export default {
  listAvailable,
  detect,
  effectiveRules,
  reconcile,
  migrate,
};
