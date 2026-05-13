import { Processor, Transformer, unified, Plugin, Data } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { VFile } from "vfile";
import type { Root } from "mdast";
import remarkLint from "remark-lint";

export function createProcessor(plugin: any, opts?: any) {
  return unified().use(remarkParse).use(remarkGfm).use(plugin, opts);
}

export async function run(
  md: string,
  processor:
    | Processor<Root, Root, Root, undefined, undefined>
    | Processor<Root, undefined, undefined, undefined, undefined>,
  filePath?: string,
) {
  const tree = processor.parse(md);
  const file = new VFile({ value: md, path: filePath });
  await processor.run(tree, file);
  return file;
}
