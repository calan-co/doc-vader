import { z } from "zod";
import matter from "gray-matter";
import path from "node:path";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import {
  DIATAXIS_CATEGORIES,
  classifyDiataxisPlacement,
} from "../diataxis/classify.js";

export const optionsSchema = z.object({
  enabled: z.boolean().optional().default(true),
});

export type Options = z.input<typeof optionsSchema>;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function resolveDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}

const remarkLintDiataxisClassifier = (function (options?: Options) {
  return function (_tree: any, file: any) {
    const emitFatal = (message: string) => {
      const node = file.message(message);
      node.fatal = true;
      node.ruleId = "diataxis-classifier";
      node.source = "remark-lint";
      return node;
    };

    let parsedOptions: Options;
    try {
      parsedOptions = optionsSchema.parse(options ?? {});
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      emitFatal(`Invalid remark-lint-diataxis-classifier options: ${reason}`);
      return;
    }

    if (!parsedOptions.enabled) return;

    const rawContent = String(file.value ?? "");
    if (!rawContent.trimStart().startsWith("---")) return;

    const parsed = matter(rawContent);
    const subtype =
      typeof parsed.data?.subtype === "string" ? parsed.data.subtype : "";

    if (!DIATAXIS_CATEGORIES.includes(subtype)) return;

    const filePath =
      typeof file.path === "string"
        ? file.path
        : typeof file.history?.[0] === "string"
          ? file.history[0]
          : "";
    if (!filePath) return;

    const location = resolveDisplayPath(filePath);
    const classification = classifyDiataxisPlacement(filePath, subtype);
    if (classification.matches) return;

    emitFatal(
      classification.docsFolder
        ? `[diataxis-classifier] File "${location}" has subtype "${subtype}" but lives under docs/${classification.docsFolder}/. Expected docs/${subtype}/.`
        : `[diataxis-classifier] File "${location}" has subtype "${subtype}" but is not under docs/. Expected docs/${subtype}/.`,
    );
  };
} as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>);

export default remarkLintDiataxisClassifier;
