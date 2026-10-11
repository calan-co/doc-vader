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
    "---\nid: target-doc\ntitle: Start Here\n---\n\n# Section One\n<a id=\"manual-anchor\"></a>\n",
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

  it("resolves duplicate filenames relative to the source through Linkity's file index", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "docs", "target.md"), "# Root Heading\n");
    fs.mkdirSync(path.join(root, "docs", "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "nested", "target.md"), "# Nested Heading\n");

    const result = await run("[Root](target.md#root-heading)", root);

    expect(result.messages).toHaveLength(0);
  });

  it("resolves wikilink titles from Linkity's file index", async () => {
    const root = fixture();
    const result = await run("[[Start Here#section-one]]", root);

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

  it("reports malformed percent encodings and continues linting", async () => {
    const root = fixture();
    const result = await run("[Bad](bad%ZZ.md)\n[Missing](missing.md)", root);

    expect(result.messages.map((message) => message.message)).toEqual([
      "Linkity missing-target: bad%ZZ.md",
      "Linkity missing-target: missing.md",
    ]);
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

  it("reports generated and ignored targets without treating them as missing", async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "docs", "generated.graph.json"), "{}");

    const result = await run(
      "[[generated.graph.json]]\n[Ignored](../node_modules/generated.md)",
      root,
    );

    expect(result.messages.map((message) => message.message)).toEqual([
      "Linkity generated-target: generated.graph.json",
      "Linkity ignored-target: ../node_modules/generated.md",
    ]);
    expect(result.messages.every((message) => !message.fatal)).toBe(true);
  });

  it("rebuilds the file index after filesystem changes", async () => {
    const root = fixture();

    expect((await run("[Later](./later.md)", root)).messages.map((message) => message.message)).toEqual([
      "Linkity missing-target: ./later.md",
    ]);
    fs.writeFileSync(path.join(root, "docs", "later.md"), "# Later\n");
    expect((await run("[Later](./later.md)", root)).messages).toHaveLength(0);
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
