//#region
/**
 * ## What is this?
 *
 * `remark-lint-crossref` is a remark-lint rule to check for broken cross-references and missing anchors in markdown links.
 *
 * ## API
 *
 * ### `unified().use(remarkLintCrossref[, options])`
 *
 * Warn when markdown links point to missing files or anchors.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), optional)
 *   — configuration object specifying the root directory for resolving links
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
 * export interface CrossrefOptions {
 *   rootDir?: string;
 * }
 * ```
 *
 * ###### Fields
 *
 * * `rootDir` (`string`, optional)
 *   — root directory for resolving relative links
 *
 * ## Recommendation
 *
 * Use this rule to enforce that all markdown links resolve to existing files and anchors, especially in documentation and knowledge bases.
 *
 * ## Fix
 *
 * Update or remove broken links and anchors. Ensure all referenced files and anchors exist.
 * [`remark-stringify`](https://github.com/remarkjs/remark/tree/main/packages/remark-stringify) can help format links consistently.
 *
 * [api-options]: #options
 * [api-remark-lint-crossref]: #unifieduseremarklintcrossref-options
 * [github-remark-stringify]: https://github.com/remarkjs/remark/tree/main/packages/remark-stringify
 * [github-unified-transformer]: https://github.com/unifiedjs/unified#transformer
 *
 * ## Examples
 *
 * @example
 *   // remark config
 *   import remarkLintCrossref from 'remark-lint-crossref';
 *   {
 *     plugins: [
 *       [remarkLintCrossref, { rootDir: './docs' }]
 *     ]
 *   }
 *
 * @example
 *   // Markdown input
 *   [Link to file](./existing-file.md)
 *   [Link to anchor](./existing-file.md#section)
 *
 *   // Output: No errors (all links resolve)
 *
 * @example
 *   // Markdown input
 *   [Broken link](./missing-file.md)
 *   [Broken anchor](./existing-file.md#missing-anchor)
 *
 *   // Output: Broken cross-reference: ./missing-file.md
 *   // Output: Missing anchor in cross-reference: ./existing-file.md#missing-anchor
 *
 * ## References
 *
 * - See https://github.com/remarkjs/remark-lint for more on remark-lint rules.
 * - See https://github.com/remarkjs/remark-lint-checkbox-character-style for a style enforcement example.
 *
 * Reports broken links and missing anchors as lint errors.
 */
/**
 * remark-lint-crossref
 *
 * Lint rule to check for broken cross-references and missing anchors in markdown links.
 *
 * @param {CrossrefOptions} [options] - Configuration options.
 * @param {string} [options.rootDir] - Root directory for resolving relative links.
 *
 * @example
 *   // In your remark config:
 *   import remarkLintCrossref from 'remark-lint-crossref';
 *   {
 *     plugins: [
 *       [remarkLintCrossref, { rootDir: './docs' }]
 *     ]
 *   }
 *
 * Reports broken links and missing anchors as lint errors.
 */
//#endregion
import { lintRule } from "unified-lint-rule";
import { visitParents } from "unist-util-visit-parents";
import fs from "fs";
import path from "path";
import * as s from "sury";

const optionsSchema = s.strict(
  s.schema({
    rootDir: s.optional(s.string),
  })
);
/**
 * @typedef {Object} CrossrefOptions
 * @property {string} [rootDir] - Root directory for resolving relative links.
 */
export type CrossrefOptions = s.Infer<typeof optionsSchema>;

const remarkLintCrossref = lintRule(
  {
    origin: "remark-lint:crossref",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (tree: any, file: any, options?: CrossrefOptions) {
    type optsSchema = s.Infer<typeof optionsSchema>;
    // Validate and normalize options using Sury schema

    let parsedOptions: CrossrefOptions = {};
    try {
      // Allow undefined by substituting an empty object
      parsedOptions = s.parseOrThrow(options ?? {}, optionsSchema);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-crossref options: ${reason}`);
      return;
    }

    const rootDir = parsedOptions.rootDir || process.cwd();
    visitParents(tree, "link", (node: any) => {
      const url: string = node.url;
      if (
        url.startsWith("./") ||
        url.startsWith("../") ||
        url.endsWith(".md")
      ) {
        const targetPath = path.resolve(rootDir, url.split("#")[0]);
        if (!fs.existsSync(targetPath)) {
          file.message(`Broken cross-reference: ${url}`, node);
        } else if (url.includes("#")) {
          const anchor = url.split("#")[1];
          const content = fs.readFileSync(targetPath, "utf8");
          if (
            !content.includes(`id: "${anchor}"`) &&
            !content.includes(`#${anchor}`)
          ) {
            file.message(`Missing anchor in cross-reference: ${url}`, node);
          }
        }
      }
    });
  }
);

export default remarkLintCrossref;
