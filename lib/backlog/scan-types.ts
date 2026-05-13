// Phase A: Backlog Scan types

export type ScanReportFormat = "json" | "text";

export type SubjectResolverName =
  | "payload_subject_tokens"
  | "linked_pull_requests";

// Phase A compatibility contracts referenced by backlog work item copy.
export interface ParsedWorkflowRun {
  id: string;
  type: "workflow_run" | "pull_request" | "work_item";
  timestamp: string;
}

export interface ParsedEvent {
  eventId: string;
  eventType: string;
  timestamp: string;
}

export interface SubjectResolutionAttempt {
  strategy: SubjectResolverName;
  subjectsFound: number;
  error?: string;
}

export interface SubjectResolutionResult {
  subjects: string[];
  strategyUsed: SubjectResolverName | null;
  attempts: SubjectResolutionAttempt[];
}

export interface BacklogScanOptions {
  /** Path to the backlog directory. Defaults to "backlog". */
  backlogDir?: string;
  /** Root directory for resolving relative paths. Defaults to cwd. */
  rootDir?: string;
  /** Include backlog/archive files. Defaults to false. */
  includeArchive?: boolean;
  /** Output format for the scan report. */
  reportFormat?: ScanReportFormat;
  /** Exit with code 1 if any findings are present. */
  strict?: boolean;
  /** Enable verbose debug logging. */
  debug?: boolean;
  /** Optional resolver execution order. */
  resolverOrder?: SubjectResolverName[];
  /** Create and link evidence records for resolved subjects. */
  generateEvidence?: boolean;
  /** Preview changes without writing files. */
  dryRun?: boolean;
  /** Optional path to consumer config JSON. */
  consumerConfig?: string;
}

// ---------- Condition taxonomy ----------

/** Positive condition code – a confirmed fact about a work item. */
export type ScanConditionCode =
  | "file_parsed"
  | "has_id"
  | "has_status"
  | "has_lifecycle"
  | "has_links_block"
  | "pr_link_found"
  | "pr_merged"
  | "workflow_succeeded"
  | "valid_status";

/** Error condition code – something went wrong or is missing. */
export type ScanErrorCode =
  | "parse_failed"
  | "missing_id"
  | "missing_status"
  | "invalid_lifecycle"
  | "unresolved_wikilink"
  | "evidence_generation_failed";

export interface ScanCondition {
  code: ScanConditionCode;
  value: boolean;
}

export type ConditionEvaluation = ScanCondition;

export interface ScanError {
  code: ScanErrorCode;
  message: string;
  ref?: string;
}

// ---------- Per-item scan result ----------

export interface WorkItemScanResult {
  file: string;
  id: string | null;
  status: string | null;
  lifecycle: string | null;
  title: string | null;
  eventMetadata?: ParsedWorkflowRun;
  conditions: ScanCondition[];
  errors: ScanError[];
  subjectResolution?: SubjectResolutionResult;
  evidenceGeneration?: {
    created: boolean;
    recordIds: string[];
    linkedAt?: string;
    errors: string[];
  };
}

export interface ScanState {
  file: string;
  parsed: ParsedEvent;
  conditions: ConditionEvaluation[];
  errors: ScanError[];
}

// ---------- Top-level report ----------

export interface BacklogScanReport {
  scanId: string;
  generatedAt: string;
  options: Required<
    Pick<BacklogScanOptions, "backlogDir" | "reportFormat" | "strict" | "debug">
  > & {
    resolverOrder: SubjectResolverName[];
  };
  summary: {
    totalFiles: number;
    filesWithErrors: number;
    errorCount: number;
    evidenceRecordsCreated: number;
  };
  items: WorkItemScanResult[];
  exitCode: number;
}

export type ScanReport = BacklogScanReport;
