// #region
/**
 * ## What is this?
 *
 * `remark-lint-checklist` is a remark-lint rule to ensure required checklist items are present in markdown files.
 *
 * ## API
 *
 * ### `unified().use(remarkLintChecklist[, options])`
 *
 * Warn when required checklist items are missing from markdown files.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), required)
 *   — configuration object specifying required checklist items
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
 * export interface ChecklistOptions {
 *   requiredItems?: string[];
 * }
 * ```
 *
 * ###### Fields
 *
 * * `requiredItems` (`string[]`, required)
 *   — array of checklist item labels that must be present as checked or unchecked items in the document
 *
 * ## Recommendation
 *
 * Use this rule to enforce the presence of specific checklist items in markdown documents, such as process steps, QA gates, or review tasks.
 *
 * ## Fix
 *
 * [`remark-stringify`](https://github.com/remarkjs/remark/tree/main/packages/remark-stringify)
 * can be used to format checklist items consistently.
 * Add the missing checklist items to your markdown file as checked (`[x]`) or unchecked (`[ ]`) items.
 *
 * [api-options]: #options
 * [api-remark-lint-checklist]: #unifieduseremarklintchecklist-options
 * [api-styles]: #styles
 * [github-remark-gfm]: https://github.com/remarkjs/remark-gfm
 * [github-remark-stringify]: https://github.com/remarkjs/remark/tree/main/packages/remark-stringify
 * [github-unified-transformer]: https://github.com/unifiedjs/unified#transformer
 *
 * ## Examples
 *
 * @example
 *   // remark config
 *   import remarkLintChecklist from 'remark-lint-checklist';
 *   {
 *     plugins: [
 *       [remarkLintChecklist, { requiredItems: ['Task 1', 'Task 2'] }]
 *     ]
 *   }
 *
 * @example
 *   // Markdown input
 *   - [x] Task 1
 *   - [ ] Task 2
 *   - [ ] Task 3
 *
 *   // Output: No errors (all required items present)
 *
 * @example
 *   // Markdown input
 *   - [x] Task 1
 *   - [ ] Task 3
 *
 *   // Output: [checklist] Required checklist item missing: Task 2
 *
 * ## References
 *
 * - See https://github.com/remarkjs/remark-lint for more on remark-lint rules.
 * - See https://github.com/remarkjs/remark-lint-checkbox-character-style for a style enforcement example.
 *
 * Reports missing checklist items as lint errors.
 */
// #endregion

import * as s from "sury";
import { lintRule } from "unified-lint-rule";
import { visitParents } from "unist-util-visit-parents";
import { Plugin } from 'unified';
import { z } from 'zod';

const optionsSchema = s.strict(
  s.schema({
    requiredItems: s.min(
      s.array(s.string),
      1,
      "'requiredItems' must be a non-empty array"
    ),
  })
);
/**
 * @typedef {Object} ChecklistOptions
 * @property {string[]} [requiredItems] - Array of required checklist item strings.
 */
export const ChecklistOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  requiredItems: z.array(z.string()).nonempty("'requiredItems' must be a non-empty array"),
});

export type ChecklistOptions = z.infer<typeof ChecklistOptionsSchema>;

const remarkLintChecklist = lintRule(
  {
    origin: "remark-lint:checklist",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (tree: any, file: any, options?: ChecklistOptions) {
    // If no options, nothing to check
    if (options === undefined) return;
    // Validate and normalize options using Sury schema
    let parsedOptions: ChecklistOptions;
    try {
      // Allow undefined by substituting an empty object
      parsedOptions = ChecklistOptionsSchema.parse(options);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-checklist options: ${reason}`);
      return;
    }

    options = parsedOptions;

    // Collect all checklist items (checked or unchecked)
    const foundItems: string[] = [];
    const foundNodes: any[] = [];
    visitParents(tree, "listItem", (node: any, ancestors: any[]) => {
      // Only consider list items with a checkbox (GFM)
      if (typeof node.checked === "boolean" && node.children?.length) {
        // Extract plain text from all children (ignoring formatting)
        const text = node.children
          .map((child: any) => {
            if (child.type === "paragraph" && child.children)
              return child.children.map((c: any) => c.value || "").join("");
            return child.value || "";
          })
          .join("")
          .trim();
        foundItems.push(text);
        foundNodes.push({ node, ancestors });
      }
    });

    // Report each missing required item
    for (const item of options.requiredItems) {
      if (!foundItems.some((found) => found === item)) {
        // Could enhance: report with ancestor context or node position
        file.message(`[checklist] Required checklist item missing: ${item}`);
      }
    }
  }
);

export default remarkLintChecklist;
