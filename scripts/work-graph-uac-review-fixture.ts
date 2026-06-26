import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stageWorkGraphUacFixture,
  workGraphUacExpectedDir,
  workGraphUacFixtureDir,
} from "../tests/helpers/work-graph-uac-fixture";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/work-graph-uac-review-fixture.ts <target-dir>",
    "",
    "Stages the deterministic Work graph UAC review fixture into <target-dir>.",
    `Fixture source: ${path.relative(repoRoot, workGraphUacFixtureDir)}`,
    `Expected outputs: ${path.relative(repoRoot, workGraphUacExpectedDir)}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const resolvedTargetDir = path.resolve(process.cwd(), targetDir);
  await mkdir(resolvedTargetDir, { recursive: true });
  await stageWorkGraphUacFixture(resolvedTargetDir);
  process.stdout.write(`${resolvedTargetDir}\n`);
}

void main();
