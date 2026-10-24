import { promises as fs } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, access: vi.fn(original.access) };
});

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

  it("falls back to legacy resources when the .dv path is not a directory", async () => {
    const root = await fixture();
    const relativePath = "templates/example.md.tpl";
    await fs.writeFile(path.join(root, ".dv"), "not a directory");
    await fs.mkdir(path.join(root, "templates"), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), "legacy");
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => process);

    await expect(resolveDefaultResourcePath(root, relativePath)).resolves.toBe(
      path.join(root, relativePath),
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("propagates errors accessing the current resource path", async () => {
    const root = await fixture();
    const relativePath = "templates/example.md.tpl";
    const error = Object.assign(new Error("access denied"), { code: "EACCES" });
    await fs.mkdir(path.join(root, "templates"), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), "legacy");
    vi.mocked(access).mockRejectedValueOnce(error);

    await expect(resolveDefaultResourcePath(root, relativePath)).rejects.toBe(error);
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
