import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vitestConfig = readFileSync(resolve(root, "vitest.config.ts"), "utf8");
const memfsIntegrationTest = readFileSync(
  resolve(root, "tests/integration-cli.memfs.test.ts"),
  "utf8",
);

describe("Vitest configuration", () => {
  it("does not load the obsolete stateful memfs mock helper", () => {
    expect(vitestConfig).not.toContain("setupTests");
    expect(memfsIntegrationTest).not.toContain("./helper/setupTests");
  });

  it("serializes test files only on Windows", () => {
    expect(vitestConfig).toContain("fileParallelism:");
    expect(vitestConfig).toContain('process.platform !== "win32"');
  });
});
