import { lintRule } from "unified-lint-rule";
import { z } from "zod";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import {
  parseWorkItemContext,
  validateArchiveReadiness,
  type WorkItemValidationStatus,
} from "./work-item-validation.js";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  statuses: z
    .array(z.enum(["ready-for-review", "closed"]))
    .optional()
    .default(["ready-for-review", "closed"]),
});

export type Options = z.input<typeof optionsSchema>;

const remarkLintWorkItemArchiveReadiness = lintRule(
  {
    origin: "remark-lint:work-item-archive-readiness",
    url: "https://github.com/remarkjs/remark-lint",
  },
  function (_tree: any, file: any, options?: Options) {
    let parsedOptions: {
      enabled: boolean;
      statuses: WorkItemValidationStatus[];
    };
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      file.fail(
        `Invalid remark-lint-work-item-archive-readiness options: ${reason}`,
      );
      return;
    }

    if (!parsedOptions.enabled) return;

    const context = parseWorkItemContext(file);
    for (const issue of validateArchiveReadiness(
      context,
      parsedOptions.statuses,
    )) {
      file.message(issue.message, {
        source: "remark-lint:work-item-archive-readiness",
      });
    }
  },
) as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintWorkItemArchiveReadiness;
