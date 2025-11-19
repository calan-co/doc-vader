import { Plugin } from 'unified';
import { z } from 'zod';

export const TemplateComplianceOptionsSchema = z.object({
  enabled: z.boolean().default(true)
});

export type TemplateComplianceOptions = z.infer<typeof TemplateComplianceOptionsSchema>;

export const remarkLintTemplateCompliance: Plugin<[TemplateComplianceOptions?]> = (options = {}) => {
  const opts = TemplateComplianceOptionsSchema.parse(options);
  // ...plugin implementation...
  return (tree, file) => {
    if (!opts.enabled) return;
    // ...existing lint logic...
  };
};
/**
 * ## What is this?
 *
 * `remark-lint-template-compliance` is a remark-lint rule to ensure required headings are present in markdown files for template compliance.
 *
 * ## API
 *
 * ### `unified().use(remarkLintTemplateCompliance[, options])`
 *
 * Warn when required headings are missing from markdown files.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), required)
 *   — configuration object specifying required headings
 *
 * ###### Returns
 *
 * Transform ([`Transformer` from `unified`](https://github.com/unifiedjs/unified#transformer)).
 *
 * ### `Options`
 *
 * Configuration (TypeScript type).
 *
 * ###### Type
 *
 * ```ts
 * export interface TemplateComplianceOptions {
 *   requiredHeadings?: string[];
 * }
 * ```
 *
 * ###### Fields
 *
 * * `requiredHeadings` (`string[]`, required)
 *   — array of heading strings that must be present in the document
 *
 * ## Recommendation
 *
 * Use this rule to enforce the presence of specific headings in markdown documents, such as those required by templates or documentation standards.
 *
 * ## Fix
 *
 * [`remark-stringify`](https://github.com/remarkjs/remark/tree/main/packages/remark-stringify)
 * can be used to format headings consistently.
 * Add the missing headings to your markdown file.
 *
 * [api-options]: #options
 * [api-remark-lint-template-compliance]: #unifieduseremarklinttemplatecompliance-options
 * [github-remark-stringify]: https://github.com/remarkjs/remark/tree/main/packages/remark-stringify
 * [github-unified-transformer]: https://github.com/unifiedjs/unified#transformer
 *
 * ## Examples
 *
 * @example
 *   // remark config
 *   import remarkLintTemplateCompliance from 'remark-lint-template-compliance';
 *   {
 *     plugins: [
 *       [remarkLintTemplateCompliance, { requiredHeadings: ['Introduction', 'Conclusion'] }]
 *     ]
 *   }
 *
 * @example
 *   // Markdown input
 *   # Introduction
 *   # Conclusion
 *
 *   // Output: No errors (all required headings present)
 *
 * @example
 *   // Markdown input
 *   # Introduction
 *
 *   // Output: [template-compliance] Missing required heading: "Conclusion"
 *
 * ## References
 *
 * - See https://github.com/remarkjs/remark-lint for more on remark-lint rules.
 * - See https://github.com/remarkjs/remark-lint-checkbox-character-style for a style enforcement example.
 *
 * Reports missing headings as lint errors.
 */

/**
 * remark-lint-template-compliance
 *
 * Lint rule to ensure required headings are present in markdown files for template compliance.
 *
 * @param {TemplateComplianceOptions} [options] - Configuration options.
 * @param {string[]} [options.requiredHeadings] - Array of required heading strings.
 *
 * @example
 *   // In your remark config:
 *   import remarkLintTemplateCompliance from 'remark-lint-template-compliance';
 *   {
 *     plugins: [
 *       [remarkLintTemplateCompliance, { requiredHeadings: ['Introduction', 'Conclusion'] }]
 *     ]
 *   }
 *
 * Reports missing headings as lint errors.
 */
import { lintRule } from "unified-lint-rule";
import { visitParents } from "unist-util-visit-parents";
import * as s from "sury";

const optionsSchema = s.strict(
  s.schema({
    requiredHeadings: s.min(
      s.array(s.string),
      1,
      "'requiredHeadings' must be a non-empty array"
    ),
  })
);

/**
 * @typedef {Object} TemplateComplianceOptions
 * @property {string[]} [requiredHeadings] - Array of required heading strings.
 */
export type TemplateComplianceOptions = s.Infer<typeof optionsSchema>;

const remarkLintTemplateCompliance = lintRule(
  {
    origin: "remark-lint:template-compliance",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (tree: any, file: any, options?: TemplateComplianceOptions) {
    // Validate and normalize options using Sury schema
    let parsedOptions: TemplateComplianceOptions;
    try {
      // Allow undefined by substituting an empty object
      parsedOptions = s.parseOrThrow(options, optionsSchema);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-template-compliance options: ${reason}`);
      return;
    }
    options = parsedOptions;

    // Collect all headings in the document
    const headings: string[] = [];
    const headingNodes: any[] = [];
    visitParents(tree, "heading", (node: any, ancestors: any[]) => {
      const text = node.children.map((c: any) => c.value || "").join("");
      headings.push(text.trim());
      headingNodes.push({ node, ancestors });
    });
    options.requiredHeadings.forEach((h) => {
      if (!headings.includes(h)) {
        // Report missing heading with ancestor context if available
        file.message(`[template-compliance] Missing required heading: "${h}"`);
      }
    });
  }
);

export default remarkLintTemplateCompliance;
