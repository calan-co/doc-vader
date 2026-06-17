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
import remarkLintDiataxisClassifier, {
  Options as DiataxisClassifierOptions,
} from "./plugins/remark-diataxis-classifier.js";
import remarkLintNamingConventions, {
  Options as NamingConventionsOptions,
} from "./plugins/remark-lint-naming-conventions.js";
import remarkLintNoAsciiDiagrams, {
  Options as NoAsciiDiagramsOptions,
} from "./plugins/remark-lint-no-ascii-diagrams.js";
import remarkLintNoHtmlAnchors, {
  Options as NoHtmlAnchorsOptions,
} from "./plugins/remark-lint-no-html-anchors.js";
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

type LintSeverity = "off" | "warn" | "error" | 0 | 1 | 2;

export interface FrontmatterSchemaProcessorOptions
  extends Readonly<FrontmatterSchemaOptions> {
  severity?: LintSeverity;
}

export interface TiabProcessorOptions {
  checklist?: Readonly<ChecklistOptions>;
  crossref?: Readonly<CrossrefOptions>;
  templateCompliance?: Readonly<TemplateComplianceOptions>;
  diataxisClassifier?: Readonly<DiataxisClassifierOptions>;
  namingConventions?: Readonly<NamingConventionsOptions>;
  noAsciiDiagrams?: Readonly<NoAsciiDiagramsOptions>;
  noHtmlAnchors?: Readonly<NoHtmlAnchorsOptions>;
  workItemArchiveReadiness?: Readonly<WorkItemArchiveReadinessOptions>;
  workItemClosureEvidence?: Readonly<WorkItemClosureEvidenceOptions>;
  frontmatterSchema?: Readonly<FrontmatterSchemaProcessorOptions>;
}

export function createTiabProcessor(options: TiabProcessorOptions = {}) {
  const severity = options.frontmatterSchema?.severity;
  const frontmatterRuleOptions: FrontmatterSchemaOptions | undefined =
    options.frontmatterSchema
      ? {
          enabled: options.frontmatterSchema.enabled,
          schemaDir: options.frontmatterSchema.schemaDir,
        }
      : undefined;

  const frontmatterSchemaConfig:
    | FrontmatterSchemaOptions
    | [LintSeverity, FrontmatterSchemaOptions] =
    severity !== undefined
      ? [severity, frontmatterRuleOptions ?? {}]
      : (frontmatterRuleOptions ?? { enabled: false });

  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLintChecklist, options.checklist)
    .use(remarkLintCrossref, options.crossref)
    .use(remarkLintTemplateCompliance, options.templateCompliance)
    .use(
      remarkLintDiataxisClassifier,
      options.diataxisClassifier ?? { enabled: false },
    )
    .use(
      remarkLintNamingConventions,
      options.namingConventions ?? { enabled: true },
    )
    .use(
      remarkLintNoAsciiDiagrams,
      options.noAsciiDiagrams ?? { enabled: false },
    )
    .use(remarkLintNoHtmlAnchors, options.noHtmlAnchors ?? { enabled: true })
    .use(remarkLintWorkItemArchiveReadiness, options.workItemArchiveReadiness)
    .use(remarkLintWorkItemClosureEvidence, options.workItemClosureEvidence)
    .use(remarkFrontmatterSchema, frontmatterSchemaConfig)
    .use(remarkStringify);
}
