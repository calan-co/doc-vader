//#region
/**
 * ## What is this?
 *
 * `remark-lint-naming-conventions` is a remark-lint rule to enforce naming conventions for documentation files.
 *
 * ## API
 *
 * ### `unified().use(remarkLintNamingConventions[, options])`
 *
 * Warn when filenames don't follow doc-vader naming conventions.
 *
 * ###### Parameters
 *
 * * `options` ([`Options`](#options), optional)
 *   — configuration object specifying naming convention rules
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
 *   excludePatterns?: string[];
 * }
 * ```
 *
 * ###### Fields
 *
 * * `enabled` (`boolean`, optional, default: `true`)
 *   — whether to enable naming convention checks
 * * `excludePatterns` (`string[]`, optional)
 *   — glob patterns for files to exclude from checks
 *
 * ## Recommendation
 *
 * Use this rule to enforce consistent naming conventions across your documentation.
 *
 * ## Fix
 *
 * Rename files to follow the established patterns:
 * - General docs: kebab-case (e.g., `project-brief.md`)
 * - Special files: UPPERCASE (README.md, CONTRIBUTING.md, etc.)
 * - Work items: `{number}.{slug}-{type}.md` (e.g., `156.lint-frontmatter-bug.md`)
 * - ADRs: `adr-###-kebab-case.md`
 * - Stories: `{epic}.{story}.story.md`
 *
 * [api-options]: #options
 */
//#endregion
import { lintRule } from "unified-lint-rule";
import { minimatch } from "minimatch";
import { z } from "zod";
import { Plugin } from "unified";
import type { Root } from "mdast";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  excludePatterns: z.array(z.string()).optional().default([]),
});

export type Options = z.input<typeof optionsSchema>;

// Naming convention patterns
const SPECIAL_FILES =
  /^(README|CONTRIBUTING|LICENSE|CHANGELOG|AGENTS)(\.md)?$/i;
const KEBAB_CASE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const WORK_ITEM = /^\d+(\.\d+(\.\d+)?)?[.-].+\.(md|yml)$/;
const ADR = /^adr-\d{3,}-[a-z0-9-]+\.md$/;
const BACKLOG_FILE = /^[0-9]+(\.)?([0-9]+)?\.?/;

const remarkLintNamingConventions = lintRule(
  {
    origin: "remark-lint:naming-conventions",
    url: "https://github.com/tiab-doc/doc-vader",
  },
  function (tree: any, file: any, options?: Options) {
    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(`Invalid remark-lint-naming-conventions options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    // Get filename from vFile
    const filename = file.basename || file.path?.split("/").pop();
    if (!filename) {
      return; // Can't validate without a filename
    }

    // Skip excluded patterns
    for (const pattern of parsedOptions.excludePatterns ?? []) {
      if (minimatch(filename, pattern)) {
        return;
      }
    }

    // Check special files (README.md, CONTRIBUTING.md, etc.)
    if (SPECIAL_FILES.test(filename)) {
      return; // Special files are allowed
    }

    // Check work items in backlog/ (numeric prefixes)
    if (BACKLOG_FILE.test(filename)) {
      if (!WORK_ITEM.test(filename)) {
        file.message(
          `Invalid backlog file naming: "${filename}" should follow pattern "{number}.{slug}-{type}.md" (e.g., "171.my-feature-epic.md")`,
          { source: "remark-lint:naming-conventions" },
        );
      }
      return;
    }

    // Check ADR files
    if (filename.startsWith("adr-")) {
      if (!ADR.test(filename)) {
        file.message(
          `Invalid ADR naming: "${filename}" should follow pattern "adr-###-kebab-case.md"`,
          { source: "remark-lint:naming-conventions" },
        );
      }
      return;
    }

    // Default: kebab-case for general files
    const nameWithoutExt = filename.replace(/\.(md|yml|yaml)$/, "");
    if (!KEBAB_CASE.test(nameWithoutExt)) {
      file.message(
        `Invalid filename: "${filename}" should use kebab-case (e.g., "my-document.md")`,
        { source: "remark-lint:naming-conventions" },
      );
    }
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintNamingConventions;
