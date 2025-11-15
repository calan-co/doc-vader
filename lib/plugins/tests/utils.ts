import { Processor, Transformer, unified, Plugin, Data } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { VFile } from "vfile";
import { Root } from "remark-parse/lib";
import remarkLint from "remark-lint";

export function createProcessor(plugin: any, opts?: any) {
  return unified().use(remarkParse).use(remarkGfm).use(plugin, opts);
}

export async function run(
  md: string,
  processor:
    | Processor<Root, Root, Root, undefined, undefined>
    | Processor<Root, undefined, undefined, undefined, undefined>
) {
  const tree = processor.parse(md);
  const file = new VFile({ value: md });
  await processor.run(tree, file);
  return file;
}
