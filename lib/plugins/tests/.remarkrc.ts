// .remarkrc.ts
/**
 * @import {Preset} from 'unified'
 */

import remarkLintChecklist from "../remark-lint-checklist.js";
import remarkLintCrossref from "../remark-lint-crossref.js";
import remarkLintTemplateCompliance from "../remark-lint-template-compliance.js";

/** @type {Preset} */
const preset = {
  plugins: [
    remarkLintChecklist,
    remarkLintCrossref,
    remarkLintTemplateCompliance,
  ],
};
export default preset;
