import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const root = path.resolve(__dirname, "..");
const cliPath = path.join(root, "cli/doc-vader.ts");

it("reports the package version", () => {
  const packageVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const output = execFileSync("node", ["--import", tsxImport, cliPath, "--version"], {
    cwd: root,
    encoding: "utf8",
  });

  expect(output.trim()).toBe(packageVersion);
});
