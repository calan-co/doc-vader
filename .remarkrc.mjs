// .remarkrc.mjs - ESM config for unified remark pipeline
import { remarkLintChecklist } from './lib/plugins/remark-lint-checklist.js';
import { remarkLintCrossref } from './lib/plugins/remark-lint-crossref.js';
import { remarkLintTemplateCompliance } from './lib/plugins/remark-lint-template-compliance.js';

export default {
  plugins: [
    [remarkLintChecklist, {/* options */}],
    [remarkLintCrossref, {/* options */}],
    [remarkLintTemplateCompliance, {/* options */}]
  ]
};
