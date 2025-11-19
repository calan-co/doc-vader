// lib/processor.ts - ESM, TypeScript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkLintChecklist } from './plugins/remark-lint-checklist';
import { remarkLintCrossref } from './plugins/remark-lint-crossref';
import { remarkLintTemplateCompliance } from './plugins/remark-lint-template-compliance';

export interface TiabProcessorOptions {
  checklist?: Record<string, unknown>;
  crossref?: Record<string, unknown>;
  templateCompliance?: Record<string, unknown>;
}

export function createTiabProcessor(options: TiabProcessorOptions = {}) {
  return unified()
    .use(remarkParse)
    .use(remarkLintChecklist, options.checklist || {})
    .use(remarkLintCrossref, options.crossref || {})
    .use(remarkLintTemplateCompliance, options.templateCompliance || {})
    .use(remarkStringify);
}
