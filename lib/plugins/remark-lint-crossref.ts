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
 * @param {Options} [options] - Configuration options.
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
import { z } from "zod";
import { Plugin } from "unified";
import type { Root } from "mdast";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  rootDir: z.string().optional(),
});

export type Options = z.input<typeof optionsSchema>;

const remarkLintCrossref = lintRule(
  {
    origin: "remark-lint:crossref",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (tree: any, file: any, options?: Options) {
    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-crossref options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;
    const rootDir = parsedOptions.rootDir || process.cwd();
    visitParents(tree, "link", (node: any) => {
      // TODO: use linkity for robust URL handling
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
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintCrossref;
