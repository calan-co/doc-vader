import { lintRule } from "unified-lint-rule";
import { z } from "zod";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import {
  parseWorkItemContext,
  validateClosedWorkItemEvidence,
} from "./work-item-validation.js";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
});

export type Options = z.input<typeof optionsSchema>;

const remarkLintWorkItemClosureEvidence = lintRule(
  {
    origin: "remark-lint:work-item-closure-evidence",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (_tree: any, file: any, options?: Options) {
    let parsedOptions: { enabled: boolean };
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(
        `Invalid remark-lint-work-item-closure-evidence options: ${reason}`,
      );
      return;
    }

    if (!parsedOptions.enabled) return;

    const context = parseWorkItemContext(file);
    for (const issue of validateClosedWorkItemEvidence(context)) {
      file.message(issue.message, {
        source: "remark-lint:work-item-closure-evidence",
      });
    }
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintWorkItemClosureEvidence;
