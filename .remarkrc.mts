// .remarkrc.mts - ESM config for unified remark pipeline
import remarkFrontmatterSchema from "./lib/plugins/remark-frontmatter-schema.js";
import remarkLintChecklist from "./lib/plugins/remark-lint-checklist.js";
import remarkLintCrossref from "./lib/plugins/remark-lint-crossref.js";
import remarkLintTemplateCompliance from "./lib/plugins/remark-lint-template-compliance.js";
import remarkLintNamingConventions from "./lib/plugins/remark-lint-naming-conventions.js";
import remarkLintNoAsciiDiagrams from "./lib/plugins/remark-lint-no-ascii-diagrams.js";
import remarkLintNoHtmlAnchors from "./lib/plugins/remark-lint-no-html-anchors.js";
import remarkLintWorkItemArchiveReadiness from "./lib/plugins/remark-lint-work-item-archive-readiness.js";
import remarkLintWorkItemClosureEvidence from "./lib/plugins/remark-lint-work-item-closure-evidence.js";

export default {
  plugins: [
    // Layer 1: Frontmatter validation
    [
      remarkFrontmatterSchema,
      {
        enabled: true,
        strict: false,
        schemaDir: "schemas/frontmatter",
      },
    ],
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
    [
      remarkLintWorkItemArchiveReadiness,
      {
        /* options */
      },
    ],
    [
      remarkLintWorkItemClosureEvidence,
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
