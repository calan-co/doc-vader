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
import remarkGfm from "remark-gfm";

export interface TiabProcessorOptions {
  checklist?: Readonly<ChecklistOptions>;
  crossref?: Readonly<CrossrefOptions>;
  templateCompliance?: Readonly<TemplateComplianceOptions>;
}

export function createTiabProcessor(options: TiabProcessorOptions = {}) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLintChecklist, options.checklist)
    .use(remarkLintCrossref, options.crossref)
    .use(remarkLintTemplateCompliance, options.templateCompliance)
    .use(remarkStringify);
}
