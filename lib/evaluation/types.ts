type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | readonly JsonValue[];

export type JsonRecord = Record<string, JsonValue>;

export type EvaluationSeverity = "info" | "warn" | "error";

export type EvaluationDisposition =
  | "pass"
  | "warn"
  | "fail"
  | "blocked"
  | "skipped";

export interface EvaluationSubject {
  type: string;
  id: string;
  ref?: string;
  title?: string;
  group?: string;
  tags?: readonly string[];
  metadata?: JsonRecord;
}

export interface EvaluationEvidence {
  ref: string;
  label?: string;
  details?: JsonRecord;
}

export interface EvaluationFollowUpReference {
  ref: string;
  label?: string;
  details?: JsonRecord;
}

export interface EvaluationFinding {
  schemaVersion: "evaluation-finding/v1";
  subject: EvaluationSubject;
  checkId: string;
  disposition: EvaluationDisposition;
  severity: EvaluationSeverity;
  reasonCode: string;
  evidence: readonly EvaluationEvidence[];
  blocking: boolean;
  followUps?: readonly EvaluationFollowUpReference[];
  message?: string;
  details?: JsonRecord;
}

export interface EvaluationCheckInput<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
> {
  subject: TSubject;
  context: TContext;
  profileId: string;
  executionId: string;
  subjectIndex: number;
  checkIndex: number;
}

export interface EvaluationCheckOutput<
  TFinding extends EvaluationFinding = EvaluationFinding,
> {
  findings: readonly TFinding[];
}

export type EvaluationCheck<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
> = ((input: EvaluationCheckInput<TSubject, TContext>) =>
  Promise<EvaluationCheckOutput<TFinding>> | EvaluationCheckOutput<TFinding>) & {
  id: string;
  label?: string;
  description?: string;
};

export interface EvaluationSummaryRule<
  TFinding extends EvaluationFinding = EvaluationFinding,
> {
  key: string;
  description?: string;
  compute: (findings: readonly TFinding[]) => JsonValue;
}

export interface EvaluationReviewProfile<
  TSubject extends EvaluationSubject = EvaluationSubject,
  TContext extends JsonRecord | undefined = JsonRecord | undefined,
  TFinding extends EvaluationFinding = EvaluationFinding,
> {
  schemaVersion: "evaluation-review-profile/v1";
  id: string;
  label: string;
  description?: string;
  checks: readonly EvaluationCheck<TSubject, TContext, TFinding>[];
  summaryRules: readonly EvaluationSummaryRule<TFinding>[];
}

export interface EvaluationReviewExecution {
  schemaVersion: "evaluation-review-execution/v1";
  executionId: string;
  profileId: string;
  startedAt: string;
  completedAt: string;
  subjectCount: number;
  checkCount: number;
}

export interface EvaluationReviewProfileSnapshot {
  schemaVersion: "evaluation-review-profile/v1";
  id: string;
  label: string;
  description?: string;
  checkIds: readonly string[];
  summaryRuleKeys: readonly string[];
}

export interface EvaluationReport<
  TFinding extends EvaluationFinding = EvaluationFinding,
> {
  schemaVersion: "evaluation-report/v1";
  profile: EvaluationReviewProfileSnapshot;
  execution: EvaluationReviewExecution;
  generatedAt: string;
  findings: readonly TFinding[];
  summary: JsonRecord;
}
