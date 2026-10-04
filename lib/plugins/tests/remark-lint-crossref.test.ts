import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crossref, { optionsSchema } from "../remark-lint-crossref";
import { createProcessor, run as runUtil } from "./utils";

const tempDirs: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linkity-crossref-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "target file.md"),
    "---\nid: target-doc\n---\n\n# Section One\n<a id=\"manual-anchor\"></a>\n",
  );
  fs.writeFileSync(path.join(root, "docs", "source.md"), "");
  return root;
}

async function run(md: string, rootDir: string, file = "docs/source.md") {
  return await runUtil(
    md,
    createProcessor(crossref, { rootDir }),
    path.join(rootDir, file),
  );
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("remark-lint-crossref", () => {
  it("uses Linkity for valid markdown paths, fragments, encoded paths, root-relative paths, extensionless paths, and wikilinks", async () => {
    const root = fixture();
    const md = [
      "[Path](./target%20file.md#section-one)",
      "[Extensionless](./target%20file#section-one)",
      "[RootRelative](docs/target%20file.md#section-one)",
      "[Manual](./target%20file.md#manual-anchor)",
      "[[target-doc#section-one]]",
      "[[target file#manual-anchor|alias]]",
    ].join("\n");

    const result = await run(md, root);

    expect(result.messages).toHaveLength(0);
  });

  it("treats external URLs and custom schemes as out of scope", async () => {
    const root = fixture();
    const result = await run(
      "[Site](https://example.com) mailto:team@example.com vscode://file/foo",
      root,
    );

    expect(result.messages).toHaveLength(0);
  });

  it("reports missing targets and anchors with Linkity failure classes", async () => {
    const root = fixture();
    const result = await run(
      "[Missing](./missing.md)\n[Anchor](./target%20file.md#nope)",
      root,
    );

    expect(result.messages.map((message) => message.message)).toEqual([
      "Linkity missing-target: ./missing.md",
      "Linkity missing-anchor: ./target%20file.md#nope",
    ]);
    expect(result.messages.every((message) => message.fatal)).toBe(false);
  });

  it("keeps templates visible without failing and ignores code spans", async () => {
    const root = fixture();
    const result = await run(
      "[Template]({{target}}.md) `[[missing-code-link]]`\n\n```\n[missing](missing.md)\n```",
      root,
    );

    expect(result.messages.map((message) => message.message)).toEqual([
      "Linkity template-target: {{target}}.md",
    ]);
    expect(result.messages[0].fatal).toBeFalsy();
  });

  it("validates options with zod", () => {
    expect(() => optionsSchema.parse({ enabled: true })).not.toThrow();
  });

  it("skips lint if disabled", async () => {
    const root = fixture();
    const result = await runUtil(
      "[Missing](./missing.md)",
      createProcessor(crossref, { enabled: false, rootDir: root }),
      path.join(root, "docs/source.md"),
    );

    expect(result.messages).toHaveLength(0);
  });
});
