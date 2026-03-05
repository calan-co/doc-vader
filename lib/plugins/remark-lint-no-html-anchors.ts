//#region
/**
 * ## What is this?
 *
 * `remark-lint-no-html-anchors` is a remark-lint rule to discourage raw HTML anchor tags in favor of markdown links.
 *
 * ## API
 *
 * ### `unified().use(remarkLintNoHtmlAnchors[, options])`
 *
 * Warn when markdown contains raw HTML anchor tags (`<a>` or `<name>` with `id` attributes).
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), optional)
 *   — configuration object
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
 * export interface Options {
 *   enabled?: boolean;
 * }
 * ```
 *
 * ###### Fields
 *
 * * `enabled` (`boolean`, optional, default: `true`)
 *   — whether to enable HTML anchor detection
 *
 * ## Recommendation
 *
 * Avoid raw HTML anchor tags. Instead, use markdown heading anchors via heading IDs or markdown link syntax.
 *
 * ## Fix
 *
 * Replace `<a id="anchor">` with markdown headings and heading ID syntax, or use proper markdown link anchors.
 * Remove `<name>` deprecated HTML tags entirely.
 *
 * [api-options]: #options
 */
//#endregion
import { lintRule } from "unified-lint-rule";
import { visitParents } from "unist-util-visit-parents";
import { z } from "zod";
import { Plugin } from "unified";
import type { Root } from "mdast";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
});

export type Options = z.input<typeof optionsSchema>;

// Patterns to detect HTML anchor tags
const HTML_ANCHOR_PATTERNS = [
  /<a\s+[^>]*id\s*=/i,        // <a id="...">
  /<a\s+[^>]*name\s*=/i,      // <a name="...">
  /<name\s+[^>]*id\s*=/i,     // <name id="...">
  /<name\s+[^>]*>/i,          // Deprecated <name> tag
];

const remarkLintNoHtmlAnchors = lintRule(
  {
    origin: "remark-lint:no-html-anchors",
    url: "https://github.com/tiab-doc/doc-vader",
  },
  function (tree: any, file: any, options?: Options) {
    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-no-html-anchors options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    visitParents(tree, "html", (node: any) => {
      const htmlContent = node.value || "";

      // Check for any HTML anchor patterns
      for (const pattern of HTML_ANCHOR_PATTERNS) {
        if (pattern.test(htmlContent)) {
          file.message(
            `Avoid raw HTML anchor tags. Use markdown heading IDs or proper markdown syntax instead.`,
            node
          );
          return; // Report once per node
        }
      }
    });
  }
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintNoHtmlAnchors;
