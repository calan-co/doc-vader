//#region
/**
 * ## What is this?
 *
 * `remark-lint-no-ascii-diagrams` is a remark-lint rule to discourage ASCII art diagrams in favor of proper diagram tools.
 *
 * ## API
 *
 * ### `unified().use(remarkLintNoAsciiDiagrams[, options])`
 *
 * Warn when markdown contains ASCII art diagrams in code blocks.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), optional)
 *   — configuration object specifying diagram detection rules
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
 *   minLines?: number;
 * }
 * ```
 *
 * ###### Fields
 *
 * * `enabled` (`boolean`, optional, default: `true`)
 *   — whether to enable ASCII diagram detection
 * * `minLines` (`number`, optional, default: `3`)
 *   — minimum consecutive lines of ASCII art to trigger warning
 *
 * ## Recommendation
 *
 * Avoid ASCII art diagrams. Instead, use proper diagramming tools like Mermaid, draw.io, or similar.
 *
 * ## Fix
 *
 * Replace ASCII art diagrams with proper diagram syntax (Mermaid, PlantUML, etc.) or external diagram tools.
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
  minLines: z.number().optional().default(3),
});

export type Options = z.input<typeof optionsSchema>;

// Heuristic to detect ASCII diagrams: multiple lines with box/arrow characters
function isLikelyAsciiDiagram(code: string, minLines: number): boolean {
  const lines = code.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < minLines) {
    return false;
  }

  // Look for patterns common in ASCII diagrams
  const boxDrawing = /[+\-=|]+/; // Box drawing
  const arrows = /[<>^v\-|]+/; // Arrows
  const slashes = /[\\\/]+/; // Slashes
  const stars = /\*+/; // Stars/emphasis

  let diagramLineCount = 0;
  const lineIndicators = lines.map((line) => {
    const boxMatches = boxDrawing.exec(line);
    const arrowMatches = arrows.exec(line);
    const slashMatches = slashes.exec(line);
    const starMatches = stars.exec(line);

    // Check if line has consistent diagram-like patterns
    const hasConsecutiveSpecialChars =
      (boxMatches && boxMatches[0].length >= 3) ||
      (arrowMatches && arrowMatches[0].length >= 2) ||
      slashMatches ||
      starMatches;

    // Also check for visual alignment patterns (repeated spacing)
    const hasAlignmentPattern = /\s{2,}[+|*\-<>^v]/.test(line);

    if (hasConsecutiveSpecialChars || hasAlignmentPattern) {
      diagramLineCount++;
      return true;
    }
    return false;
  });

  // If most lines look like they're part of a diagram structure, flag it
  const diagramRatio = diagramLineCount / lines.length;
  return diagramRatio >= 0.6; // At least 60% of lines look like diagram elements
}

const remarkLintNoAsciiDiagrams = lintRule(
  {
    origin: "remark-lint:no-ascii-diagrams",
    url: "https://github.com/tiab-doc/doc-vader",
  },
  function (tree: any, file: any, options?: Options) {
    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-no-ascii-diagrams options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    visitParents(tree, "code", (node: any) => {
      if (isLikelyAsciiDiagram(node.value, parsedOptions.minLines)) {
        file.message(
          `Avoid ASCII art diagrams. Use Mermaid, PlantUML, or proper diagram tools instead.`,
          node,
        );
      }
    });
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintNoAsciiDiagrams;
