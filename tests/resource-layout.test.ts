import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveDefaultConfigPath,
  resolveDefaultResourcePath,
} from "../lib/resource-layout.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dv-layout-"));
  roots.push(root);
  return root;
}

describe("resource layout migration", () => {
  it("uses .dv resources before root-level templates", async () => {
    const root = await fixture();
    const relativePath = "templates/example.md.tpl";
    await fs.mkdir(path.join(root, ".dv", "templates"), { recursive: true });
    await fs.mkdir(path.join(root, "templates"), { recursive: true });
    await fs.writeFile(path.join(root, ".dv", relativePath), "new");
    await fs.writeFile(path.join(root, relativePath), "legacy");

    await expect(resolveDefaultResourcePath(root, relativePath)).resolves.toBe(
      path.join(root, ".dv", relativePath),
    );
  });

  it("uses legacy root resources and dv.yaml with deprecation warnings", async () => {
    const root = await fixture();
    const relativePath = "templates/example.md.tpl";
    await fs.mkdir(path.join(root, "templates"), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), "legacy");
    await fs.writeFile(path.join(root, "dv.yaml"), "namespace: legacy\n");
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => process);

    await expect(resolveDefaultResourcePath(root, relativePath)).resolves.toBe(
      path.join(root, relativePath),
    );
    await expect(resolveDefaultConfigPath(root)).resolves.toBe(path.join(root, "dv.yaml"));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
