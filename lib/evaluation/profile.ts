import type {
  EvaluationCheck,
  EvaluationFinding,
  EvaluationReport,
  EvaluationReviewExecution,
  EvaluationReviewProfile,
  EvaluationReviewProfileSnapshot,
  EvaluationSubject,
  EvaluationSummaryRule,
  JsonRecord,
} from "./types.js";

export interface ReviewProfileRegistry<
  TProfile extends EvaluationReviewProfile = EvaluationReviewProfile,
> {
  register: (profile: TProfile) => void;
  get: (profileId: string) => TProfile | undefined;
  list: () => readonly TProfile[];
}

export interface ComposeReviewProfileOptions<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
> {
  id: string;
  label: string;
  description?: string;
  profiles: readonly EvaluationReviewProfile<TSubject, TContext, TFinding>[];
}

function ensureUniqueKeys(
  entries: readonly { key: string }[],
  kind: "check" | "summary rule",
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      throw new Error(`Duplicate ${kind} key '${entry.key}'.`);
    }
    seen.add(entry.key);
  }
}

function firstDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined);
}

export function createReviewProfileRegistry<
  TProfile extends EvaluationReviewProfile = EvaluationReviewProfile,
>(): ReviewProfileRegistry<TProfile> {
  const profiles = new Map<string, TProfile>();
  return {
    register(profile: TProfile): void {
      const existing = profiles.get(profile.id);
      if (existing && existing !== profile) {
        throw new Error(`Duplicate review profile id '${profile.id}'.`);
      }
      profiles.set(profile.id, profile);
    },
    get(profileId: string): TProfile | undefined {
      return profiles.get(profileId);
    },
    list(): readonly TProfile[] {
      return [...profiles.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    },
  };
}

export function createReviewProfile<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
>(
  profile: Omit<
    EvaluationReviewProfile<TSubject, TContext, TFinding>,
    "schemaVersion"
  >,
): EvaluationReviewProfile<TSubject, TContext, TFinding> {
  ensureUniqueKeys(
    profile.checks.map((check) => ({ key: check.id })),
    "check",
  );
  ensureUniqueKeys(profile.summaryRules, "summary rule");
  return {
    schemaVersion: "evaluation-review-profile/v1",
    ...profile,
    checks: [...profile.checks],
    summaryRules: [...profile.summaryRules],
  };
}

export function composeReviewProfile<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
>(
  options: ComposeReviewProfileOptions<TSubject, TContext, TFinding>,
): EvaluationReviewProfile<TSubject, TContext, TFinding> {
  const profiles = [...options.profiles];
  if (profiles.length === 0) {
    return createReviewProfile({
      id: options.id,
      label: options.label,
      description: options.description,
      checks: [],
      summaryRules: [],
    });
  }

  const checks = profiles.flatMap((profile) => profile.checks);
  const summaryRules = profiles.flatMap((profile) => profile.summaryRules);
  const description =
    options.description ?? firstDefined(profiles.map((profile) => profile.description));
  const merged = createReviewProfile({
    id: options.id,
    label: options.label,
    description,
    checks,
    summaryRules,
  });
  return merged;
}

export function snapshotReviewProfile<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
>(
  profile: EvaluationReviewProfile<TSubject, TContext, TFinding>,
): EvaluationReviewProfileSnapshot {
  return {
    schemaVersion: "evaluation-review-profile/v1",
    id: profile.id,
    label: profile.label,
    ...(profile.description ? { description: profile.description } : {}),
    checkIds: profile.checks.map((check) => check.id),
    summaryRuleKeys: profile.summaryRules.map((rule) => rule.key),
  };
}

export function normalizeReviewExecution(
  execution: Omit<EvaluationReviewExecution, "schemaVersion">,
): EvaluationReviewExecution {
  return {
    schemaVersion: "evaluation-review-execution/v1",
    ...execution,
  };
}
