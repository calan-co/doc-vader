// .remarkrc.mts - ESM config for unified remark pipeline
import remarkLintChecklist from "./lib/plugins/remark-lint-checklist.js";
import remarkLintCrossref from "./lib/plugins/remark-lint-crossref.js";
import remarkLintTemplateCompliance from "./lib/plugins/remark-lint-template-compliance.js";
import remarkLintNamingConventions from "./lib/plugins/remark-lint-naming-conventions.js";
import remarkLintNoAsciiDiagrams from "./lib/plugins/remark-lint-no-ascii-diagrams.js";
import remarkLintNoHtmlAnchors from "./lib/plugins/remark-lint-no-html-anchors.js";

export default {
  plugins: [
    // Layer 2: Template and content compliance
    [
      remarkLintChecklist,
      {
        /* options */
      },
    ],
    [
      remarkLintTemplateCompliance,
      {
        /* options */
      },
    ],
    [
      remarkLintNoAsciiDiagrams,
      {
        enabled: false,
      },
    ],
    [
      remarkLintNoHtmlAnchors,
      {
        /* options */
      },
    ],
    // Layer 3: Cross-reference and naming validation
    [
      remarkLintCrossref,
      {
        /* options */
      },
    ],
    [
      remarkLintNamingConventions,
      {
        /* options */
      },
    ],
  ],
};
