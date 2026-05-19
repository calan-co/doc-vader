// lib/processor.ts - ESM, TypeScript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkLintChecklist, {
  Options as ChecklistOptions,
} from "./plugins/remark-lint-checklist.js";
import remarkLintCrossref, {
  Options as CrossrefOptions,
} from "./plugins/remark-lint-crossref.js";
import remarkLintTemplateCompliance, {
  Options as TemplateComplianceOptions,
} from "./plugins/remark-lint-template-compliance.js";
import remarkLintWorkItemArchiveReadiness, {
  Options as WorkItemArchiveReadinessOptions,
} from "./plugins/remark-lint-work-item-archive-readiness.js";
import remarkLintWorkItemClosureEvidence, {
  Options as WorkItemClosureEvidenceOptions,
} from "./plugins/remark-lint-work-item-closure-evidence.js";
import remarkGfm from "remark-gfm";
import remarkFrontmatterSchema, {
  Options as FrontmatterSchemaOptions,
} from "./plugins/remark-frontmatter-schema.js";

export interface TiabProcessorOptions {
  checklist?: Readonly<ChecklistOptions>;
  crossref?: Readonly<CrossrefOptions>;
  templateCompliance?: Readonly<TemplateComplianceOptions>;
  workItemArchiveReadiness?: Readonly<WorkItemArchiveReadinessOptions>;
  workItemClosureEvidence?: Readonly<WorkItemClosureEvidenceOptions>;
  frontmatterSchema?: Readonly<FrontmatterSchemaOptions>;
}

export function createTiabProcessor(options: TiabProcessorOptions = {}) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLintChecklist, options.checklist)
    .use(remarkLintCrossref, options.crossref)
    .use(remarkLintTemplateCompliance, options.templateCompliance)
    .use(remarkLintWorkItemArchiveReadiness, options.workItemArchiveReadiness)
    .use(remarkLintWorkItemClosureEvidence, options.workItemClosureEvidence)
    // Keep schema validation opt-in here until local/remote schema ref
    // resolution is fully unified across all lint entrypoints.
    .use(remarkFrontmatterSchema, options.frontmatterSchema ?? { enabled: false })
    .use(remarkStringify);
}
