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

const RULE_ID = "diataxis-classifier";
const SOURCE = "remark-lint";

type RemarkFile = {
  value?: unknown;
  path?: unknown;
  history?: unknown[];
  message(message: string): {
    fatal?: boolean;
    ruleId?: string;
    source?: string;
  };
};

function resolveDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}

function getFilePath(file: RemarkFile): string {
  if (typeof file.path === "string") {
    return file.path;
  }

  const firstHistoryEntry = file.history?.[0];
  if (typeof firstHistoryEntry === "string") {
    return firstHistoryEntry;
  }

  return "";
}

function formatViolationMessage(
  location: string,
  subtype: string,
  classification: ReturnType<typeof classifyDiataxisPlacement>,
): string {
  if (classification.docsFolder) {
    return `[diataxis-classifier] File "${location}" has subtype "${subtype}" but lives under docs/${classification.docsFolder}/. Expected docs/${subtype}/.`;
  }

  return `[diataxis-classifier] File "${location}" has subtype "${subtype}" but is not under docs/. Expected docs/${subtype}/.`;
}

const remarkLintDiataxisClassifier = function (
  options?: Readonly<Options> | null,
) {
  return function (_tree: Root, file: RemarkFile) {
    const emitFatal = (message: string) => {
      const node = file.message(message);
      node.fatal = true;
      node.ruleId = RULE_ID;
      node.source = SOURCE;
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

    const filePath = getFilePath(file);
    if (!filePath) return;

    const location = resolveDisplayPath(filePath);
    const classification = classifyDiataxisPlacement(filePath, subtype);
    if (classification.matches) return;

    emitFatal(formatViolationMessage(location, subtype, classification));
  };
} as unknown as Plugin<[(Readonly<Options> | null | undefined)?], string, Root>;

export default remarkLintDiataxisClassifier;
