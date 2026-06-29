import { promises as fs } from "node:fs";
import path from "node:path";
import { renderTempljsTemplate } from "../template/render.js";
import type { CanonicalTaskModel } from "./canonical.js";
import { loadCanonicalTask } from "./canonical.js";
import { omitRelationshipBodySections } from "./body-sections.js";
import { projectWorkGraph, type WorkGraphEdge } from "../work/projection.js";
import { canonicalizeWorkItemScopeRef } from "../work/scope-ref.js";

export interface TaskShowRelationship {
  type: "depends_on" | "belongs_to" | "implements";
  target: string;
}

export interface TaskShowRecordRelationship {
  type: "records";
  target: string;
}

export interface TaskShowActiveLock {
  claimToken: string;
  scopeRef: string;
  lockMode: string;
}

export interface TaskShowModel extends CanonicalTaskModel {
  relationships?: TaskShowRelationship[];
  records?: TaskShowRecordRelationship[];
  activeLocks?: TaskShowActiveLock[];
}

export interface LoadTaskShowOptions {
  rootDir?: string;
  backlogDir?: string;
  taskId: string;
}

export interface RenderTaskShowOptions {
  rootDir?: string;
  templatePath?: string;
  task: TaskShowModel;
}

const DEFAULT_BACKLOG_DIR = "backlog";
const HUMAN_TEMPLATE_PATH = "templates/reference/task/show.md.tpl";

function resolveRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? process.cwd());
}

function resolveFromRoot(rootDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(rootDir, targetPath);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function displayTarget(edge: WorkGraphEdge, fallback: string): string {
  const rawTarget = asString(edge.properties.rawTarget);
  if (rawTarget) {
    return rawTarget;
  }
  const subject = asString(edge.properties.subject);
  if (subject) {
    return subject;
  }
  return fallback;
}

function stableUniqueByTypeAndTarget<T extends { type: string; target: string }>(
  values: T[],
): T[] {
  const unique = new Map<string, T>();
  for (const value of values) {
    unique.set(`${value.type}\u0000${value.target}`, value);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) || left.target.localeCompare(right.target),
  );
}

function stableUniqueLocks(values: TaskShowActiveLock[]): TaskShowActiveLock[] {
  const unique = new Map<string, TaskShowActiveLock>();
  for (const value of values) {
    unique.set(
      `${value.claimToken}\u0000${value.scopeRef}\u0000${value.lockMode}`,
      value,
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.claimToken.localeCompare(right.claimToken) ||
      left.scopeRef.localeCompare(right.scopeRef) ||
      left.lockMode.localeCompare(right.lockMode),
  );
}

export async function loadTaskShowModel(
  options: LoadTaskShowOptions,
): Promise<TaskShowModel> {
  const rootDir = resolveRoot(options.rootDir);
  const task = await loadCanonicalTask(options);
  const projection = await projectWorkGraph({
    rootDir,
    workspaceDirs: [options.backlogDir ?? DEFAULT_BACKLOG_DIR, "docs"],
  });
  const workItemNodeId = canonicalizeWorkItemScopeRef(task.id);
  const scopeNodeId = `scope:${workItemNodeId}`;

  const dependencyEdges = projection
    .getOutgoingEdges(workItemNodeId)
    .filter((edge) => edge.authority === "formal" && edge.type === "depends_on");
  const relationshipEdges = projection
    .getOutgoingEdges(workItemNodeId)
    .filter(
      (edge) =>
        edge.authority === "formal" &&
        (edge.type === "belongs_to" || edge.type === "implements"),
    );
  const recordEdges = projection
    .getIncomingEdges(workItemNodeId)
    .filter((edge) => edge.authority === "formal" && edge.type === "records");
  const lockEdges = projection
    .getIncomingEdges(scopeNodeId)
    .filter((edge) => edge.authority === "formal" && edge.type === "locks");

  const dependencies = stableUniqueByTypeAndTarget(
    dependencyEdges.map((edge) => ({
      type: "depends_on" as const,
      target: displayTarget(edge, edge.to),
    })),
  );
  const relationships = stableUniqueByTypeAndTarget(
    relationshipEdges.map((edge) => ({
      type:
        edge.type === "belongs_to"
          ? ("belongs_to" as const)
          : ("implements" as const),
      target: displayTarget(edge, edge.to),
    })),
  );
  const records = stableUniqueByTypeAndTarget(
    recordEdges.map((edge) => ({
      type: "records" as const,
      target: displayTarget(edge, edge.from),
    })),
  );
  const activeLocks = stableUniqueLocks(
    lockEdges
      .map((edge) => {
        const claimToken = asString(edge.properties.claimToken);
        const scopeRef = asString(edge.properties.scopeRef);
        const lockMode = asString(edge.properties.lockMode);
        if (!claimToken || !scopeRef || !lockMode) {
          return null;
        }
        return {
          claimToken,
          scopeRef,
          lockMode,
        };
      })
      .filter((entry): entry is TaskShowActiveLock => entry !== null),
  );

  return {
    ...task,
    dependencies,
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(records.length > 0 ? { records } : {}),
    ...(activeLocks.length > 0 ? { activeLocks } : {}),
  };
}

export async function renderHumanTaskShow(
  options: RenderTaskShowOptions,
): Promise<string> {
  const rootDir = resolveRoot(options.rootDir);
  const templatePath = resolveFromRoot(
    rootDir,
    options.templatePath ?? HUMAN_TEMPLATE_PATH,
  );
  return renderTempljsTemplate(await fs.readFile(templatePath, "utf8"), {
    ...options.task,
    task: options.task,
    body: {
      ...options.task.body,
      sections: omitRelationshipBodySections(options.task.body.sections),
    },
  });
}
