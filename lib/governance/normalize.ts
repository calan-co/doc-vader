import { promises as fs } from "node:fs";
import matter from "gray-matter";

export type GovernanceInput = any;

export interface CanonicalGovernanceProfile {
  name: string;
  mode?: "strict" | "advisory";
  version?: string;
  notes?: string;
  sourceForm: "array" | "scalarMap" | "objectMap";
}

export interface CanonicalGovernance {
  profiles: CanonicalGovernanceProfile[];
  priorityOrder?: string[];
  reconciliation?: {
    defaultStrategy?: string;
    strategies?: any[]; // leave generic until strategy engine implemented
  };
}

// Category inference table (extensible)
export const CATEGORY_MAP: Record<string, string> = {
  diataxis: "documentation",
  tgdp: "documentation",
  tgdpr: "documentation", // supporting alternative spelling from earlier docs
  sdlc: "process",
  agile: "process",
  "security-handoff": "security",
  compliance: "compliance",
};

/**
 * Normalize the governance section of frontmatter supporting the 3 input styles:
 * 1) Array of profile names
 * 2) Map of name -> mode (string)
 * 3) Map of name -> object { mode, version, notes }
 */
export function normalizeGovernance(
  raw: GovernanceInput
): CanonicalGovernance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { profiles: rawProfiles, reconciliation } = raw as any;
  if (!rawProfiles) return undefined;
  const canonical: CanonicalGovernanceProfile[] = [];
  let priorityOrder: string[] | undefined;

  if (Array.isArray(rawProfiles)) {
    for (const item of rawProfiles) {
      if (typeof item !== "string") continue;
      canonical.push({ name: item.trim(), sourceForm: "array" });
    }
  } else if (typeof rawProfiles === "object") {
    // Extract priorityOrder (non-profile key)
    if (Array.isArray((rawProfiles as any).priorityOrder)) {
      priorityOrder = (rawProfiles as any).priorityOrder.map((x: any) =>
        String(x)
      );
    }
    for (const [key, value] of Object.entries(rawProfiles)) {
      if (key === "priorityOrder") continue;
      if (typeof value === "string") {
        canonical.push({
          name: key,
          mode: value as any,
          sourceForm: "scalarMap",
        });
      } else if (value && typeof value === "object") {
        const { mode, version, notes } = value as any;
        canonical.push({
          name: key,
          mode,
          version,
          notes,
          sourceForm: "objectMap",
        });
      }
    }
  }

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const deduped: CanonicalGovernanceProfile[] = [];
  for (const p of canonical) {
    const k = p.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(p);
  }

  return {
    profiles: deduped,
    priorityOrder,
    reconciliation: reconciliation || undefined,
  };
}

export async function loadFileFrontmatter(filePath: string): Promise<any> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  return (parsed.data || {}) as Record<string, any>;
}

export function inferCategories(
  canonical: CanonicalGovernance
): Array<CanonicalGovernanceProfile & { category?: string }> {
  return canonical.profiles.map((p) => ({
    ...p,
    category: CATEGORY_MAP[p.name.toLowerCase()],
  }));
}

export function buildEffectiveRules(canonical: CanonicalGovernance) {
  return {
    profiles: inferCategories(canonical),
    priorityOrder: canonical.priorityOrder,
    reconciliation: canonical.reconciliation,
  };
}
