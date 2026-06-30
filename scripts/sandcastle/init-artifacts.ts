import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, "../..");
const adapterCommand = "node --import tsx scripts/sandcastle/dv4sandcastle.ts";

export const sandcastleInitTemplateArgs = {
  LIST_TASKS_COMMAND: `${adapterCommand} list`,
  VIEW_TASK_COMMAND: `${adapterCommand} view`,
  CLOSE_TASK_COMMAND: `${adapterCommand} close-task`,
  ISSUE_TRACKER_TOOLS: [
    "# Doc-Vader custom issue tracker: uses the repository checkout, Node.js, and tsx.",
    "# No external issue-tracker CLI install is required.",
  ].join("\n"),
  PROMPT_TASK_COMMAND: `${adapterCommand} prompt`,
  CLAIM_TASK_COMMAND: `${adapterCommand} claim-task`,
  LOCK_STATUS_COMMAND: `${adapterCommand} lock-status`,
  RECORD_TASK_COMMAND: `${adapterCommand} record-task`,
  RECOVER_TASK_COMMAND: `${adapterCommand} recover-task`,
} as const;

type SandcastleInitTemplateArg = keyof typeof sandcastleInitTemplateArgs;
type SandcastleInitArtifactDefinition = Omit<SandcastleInitArtifact, "content">;

export interface SandcastleInitArtifact {
  outputRelativePath: string;
  templateRelativePath: string;
  content: string;
}

export interface RenderSandcastleInitArtifactsOptions {
  rootDir?: string;
  write?: boolean;
}

const sandcastleInitArtifactDefinitions: readonly SandcastleInitArtifactDefinition[] = [
  {
    templateRelativePath: "scripts/sandcastle/templates/plan-prompt.md.tpl",
    outputRelativePath: ".sandcastle/plan-prompt.md",
  },
  {
    templateRelativePath: "scripts/sandcastle/templates/implement-prompt.md.tpl",
    outputRelativePath: ".sandcastle/implement-prompt.md",
  },
  {
    templateRelativePath: "scripts/sandcastle/templates/SETUP_ISSUE_TRACKER.md.tpl",
    outputRelativePath: ".sandcastle/SETUP_ISSUE_TRACKER.md",
  },
] as const;

function isSandcastleInitTemplateArg(value: string): value is SandcastleInitTemplateArg {
  return Object.hasOwn(sandcastleInitTemplateArgs, value);
}

export function substituteSandcastleInitTemplateArgs(template: string): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    return isSandcastleInitTemplateArg(key) ? sandcastleInitTemplateArgs[key] : match;
  });
}

async function renderSandcastleInitArtifact(
  rootDir: string,
  definition: SandcastleInitArtifactDefinition,
): Promise<SandcastleInitArtifact> {
  const templatePath = path.join(rootDir, definition.templateRelativePath);
  const content = substituteSandcastleInitTemplateArgs(
    await readFile(templatePath, "utf8"),
  );
  return {
    ...definition,
    content,
  };
}

async function writeSandcastleInitArtifact(
  rootDir: string,
  artifact: SandcastleInitArtifact,
): Promise<void> {
  const outputPath = path.join(rootDir, artifact.outputRelativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, artifact.content, "utf8");
}

export async function renderSandcastleInitArtifacts(
  options: RenderSandcastleInitArtifactsOptions = {},
): Promise<SandcastleInitArtifact[]> {
  const rootDir = path.resolve(options.rootDir ?? defaultRootDir);
  const artifacts = await Promise.all(
    sandcastleInitArtifactDefinitions.map((definition) =>
      renderSandcastleInitArtifact(rootDir, definition),
    ),
  );

  if (options.write) {
    for (const artifact of artifacts) {
      await writeSandcastleInitArtifact(rootDir, artifact);
    }
  }

  return artifacts;
}

async function main(): Promise<void> {
  const artifacts = await renderSandcastleInitArtifacts({ write: true });
  for (const artifact of artifacts) {
    console.log(`rendered ${artifact.outputRelativePath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
