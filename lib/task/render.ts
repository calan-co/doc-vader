import { promises as fs } from "node:fs";
import path from "node:path";
import { renderTempljsTemplate } from "../template/render.js";
import type { TaskModel } from "./model.js";

const HUMAN_TEMPLATE_PATH = "templates/reference/task/show.md.tpl";
const PROMPT_TEMPLATE_PATH = "templates/reference/task/prompt.md.tpl";

export async function renderTaskView(
  task: TaskModel,
  options: { rootDir?: string; templatePath?: string } = {},
): Promise<string> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const templatePath = path.resolve(
    rootDir,
    options.templatePath ?? HUMAN_TEMPLATE_PATH,
  );
  return renderTempljsTemplate(await fs.readFile(templatePath, "utf8"), {
    ...(task as unknown as Record<string, unknown>),
    task,
  });
}

export async function renderTaskPrompt(
  task: TaskModel,
  options: { rootDir?: string; templatePath?: string } = {},
): Promise<string> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const templatePath = path.resolve(
    rootDir,
    options.templatePath ?? PROMPT_TEMPLATE_PATH,
  );
  return renderTempljsTemplate(await fs.readFile(templatePath, "utf8"), {
    ...(task as unknown as Record<string, unknown>),
    task,
  });
}
