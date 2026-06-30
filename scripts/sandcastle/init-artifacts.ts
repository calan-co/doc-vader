import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, "../..");
const adapterCommand = "node --import tsx scripts/sandcastle/dv-adapter.ts";

export const sandcastleInitTemplateArgs = {
  LIST_TASKS_COMMAND: `${adapterCommand} list`,
  VIEW_TASK_COMMAND: `${adapterCommand} view`,
  CLOSE_TASK_COMMAND: `${adapterCommand} close`,
  ISSUE_TRACKER_TOOLS: [
    "# Doc-Vader custom issue tracker: uses the repository checkout, Node.js, and tsx.",
    "# No external issue-tracker CLI install is required.",
  ].join("\n"),
  PROMPT_TASK_COMMAND: `${adapterCommand} prompt`,
  CLAIM_TASK_COMMAND: `${adapterCommand} claim`,
  LOCK_STATUS_COMMAND: `${adapterCommand} lock-status`,
  RECORD_TASK_COMMAND: `${adapterCommand} record`,
  RECOVER_TASK_COMMAND: `${adapterCommand} recover`,
} as const;

type SandcastleInitTemplateArg = keyof typeof sandcastleInitTemplateArgs;

export interface SandcastleInitArtifact {
  outputRelativePath: string;
  templateRelativePath: string;
  content: string;
}

export interface RenderSandcastleInitArtifactsOptions {
  rootDir?: string;
  write?: boolean;
}

const sandcastleInitArtifactMappings = [
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

export function substituteSandcastleInitTemplateArgs(template: string): string {
  let content = template;
  for (const [key, value] of Object.entries(sandcastleInitTemplateArgs) as Array<
    [SandcastleInitTemplateArg, string]
  >) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return content;
}

export async function renderSandcastleInitArtifacts(
  options: RenderSandcastleInitArtifactsOptions = {},
): Promise<SandcastleInitArtifact[]> {
  const rootDir = path.resolve(options.rootDir ?? defaultRootDir);
  const artifacts = await Promise.all(
    sandcastleInitArtifactMappings.map(async (artifact) => {
      const templatePath = path.join(rootDir, artifact.templateRelativePath);
      const content = substituteSandcastleInitTemplateArgs(
        await readFile(templatePath, "utf8"),
      );
      return {
        ...artifact,
        content,
      };
    }),
  );

  if (options.write) {
    for (const artifact of artifacts) {
      const outputPath = path.join(rootDir, artifact.outputRelativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, artifact.content, "utf8");
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
