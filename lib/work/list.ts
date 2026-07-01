import path from "node:path";
import { loadTaskModel, type LoadTaskOptions, type TaskModel } from "../task/model.js";
import * as projectionModule from "./projection.js";

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeBacklogDir(backlogDir: string): string {
  return toPosixPath(backlogDir).replace(/\/+$/u, "");
}

function isListableBacklogWorkItem(
  node: {
    source: { filePath?: string };
    properties: Record<string, unknown>;
  },
  backlogDir: string,
): boolean {
  const filePath = node.source.filePath;
  if (!filePath) {
    return false;
  }

  const backlogRoot = `${backlogDir}/`;
  if (!filePath.startsWith(backlogRoot)) {
    return false;
  }

  if (
    filePath.startsWith(`${backlogDir}/archive/`) ||
    filePath.startsWith(`${backlogDir}/audit/`) ||
    filePath.startsWith(`${backlogDir}/records/`)
  ) {
    return false;
  }

  const lifecycle = typeof node.properties.lifecycle === "string"
    ? node.properties.lifecycle
    : undefined;
  const status = typeof node.properties.status === "string"
    ? node.properties.status
    : undefined;
  return lifecycle !== "archived" && status !== "closed" && status !== "completed";
}

export async function listWorkModels(
  options: LoadTaskOptions = {},
): Promise<TaskModel[]> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = normalizeBacklogDir(options.backlogDir ?? "backlog");
  const projection = await projectionModule.projectWorkGraph({
    rootDir,
    workspaceDirs: [...new Set([backlogDir, "docs"])],
  });

  const workItemIds = projection
    .getNodesByType("work-item")
    .filter((node) => isListableBacklogWorkItem(node, backlogDir))
    .map((node) => node.properties.frontmatterId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return Promise.all(
    workItemIds.map((workItemId) =>
      loadTaskModel(workItemId, {
        rootDir,
        backlogDir,
      })
    ),
  );
}

export type { LoadTaskOptions as LoadWorkOptions, TaskModel as WorkModel } from "../task/model.js";
