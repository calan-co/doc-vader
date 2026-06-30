import path from "node:path";
import {
  listWorkModels,
  selectReadyWorkItems,
  type WorkModel,
} from "../work/index.js";
import type { ReadyTaskExclusion, ReadyTaskSelection } from "../task/ready.js";

const MAX_SECTION_EXCERPT_LENGTH = 420;

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface SandcastlePlanningBodySection {
  heading: string;
  excerpt: string;
}

export interface SandcastlePlanningDependency {
  id: string;
  ref: string;
  status?: string;
  lifecycle?: string;
  filePath?: string;
  satisfied: boolean;
}

export interface SandcastlePlanningEntry {
  id: string;
  number: string;
  title: string;
  summary?: string;
  status: string;
  lifecycle: string;
  priority?: string;
  tags: string[];
  dependencies: SandcastlePlanningDependency[];
  references: string[];
  filePath: string;
  bodySections: SandcastlePlanningBodySection[];
  branch?: string;
  runtime?: WorkModel["runtime"];
}

export interface SandcastleSelectablePlanningEntry
  extends SandcastlePlanningEntry {
  lane: "selectable";
}

export interface SandcastleHorizonPlanningEntry
  extends SandcastlePlanningEntry {
  lane: "horizon";
  reasonCodes: string[];
  reasons: ReadyTaskExclusion["reasons"];
  findings: ReadyTaskExclusion["findings"];
}

export interface SandcastlePlanningListPayload {
  schemaVersion: "dv4sandcastle-list/v1";
  selectable: SandcastleSelectablePlanningEntry[];
  horizon: SandcastleHorizonPlanningEntry[];
}

export interface LoadSandcastlePlanningListOptions {
  rootDir?: string;
  backlogDir?: string;
}

function taskNumber(taskId: string): string {
  return taskId.replace(/^wi-/, "");
}

function priorityRank(priority: string | undefined): number {
  return priority ? (PRIORITY_RANK[priority.toLowerCase()] ?? 4) : 4;
}

function comparePlanningEntries(
  left: { priority?: string; filePath: string },
  right: { priority?: string; filePath: string },
): number {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return left.filePath.localeCompare(right.filePath);
}

function toBodySectionExcerpts(
  sections: WorkModel["bodySections"],
): SandcastlePlanningBodySection[] {
  return sections.map((section) => {
    const normalized = section.body.replace(/\s+/g, " ").trim();
    const excerpt =
      normalized.length > MAX_SECTION_EXCERPT_LENGTH
        ? `${normalized.slice(0, MAX_SECTION_EXCERPT_LENGTH - 3)}...`
        : normalized;
    return {
      heading: section.heading,
      excerpt,
    };
  });
}

function toBranch(task: { numericId?: string }): string | undefined {
  return task.numericId ? `sandcastle/issue-${task.numericId}` : undefined;
}

function toPlanningEntry(task: WorkModel): SandcastlePlanningEntry {
  const branch = toBranch(task);
  return {
    id: taskNumber(task.id),
    number: taskNumber(task.id),
    title: task.title,
    ...(task.summary ? { summary: task.summary } : {}),
    status: task.status,
    lifecycle: task.lifecycle,
    ...(task.priority ? { priority: task.priority } : {}),
    tags: task.tags,
    dependencies: task.dependencies.map((dependency) => ({
      id: dependency.id,
      ref: dependency.ref,
      ...(dependency.status ? { status: dependency.status } : {}),
      ...(dependency.lifecycle ? { lifecycle: dependency.lifecycle } : {}),
      ...(dependency.filePath ? { filePath: dependency.filePath } : {}),
      satisfied: dependency.satisfied,
    })),
    references: task.references,
    filePath: task.filePath,
    bodySections: toBodySectionExcerpts(task.bodySections),
    ...(branch ? { branch } : {}),
    ...(task.runtime ? { runtime: task.runtime } : {}),
  };
}

function exclusionMap(
  selection: ReadyTaskSelection,
): Map<string, ReadyTaskExclusion> {
  return new Map(
    selection.exclusions
      .map((entry) => [entry.id, entry] as const)
      .filter((entry): entry is readonly [string, ReadyTaskExclusion] => Boolean(entry[0])),
  );
}

export function buildSandcastlePlanningListPayload(options: {
  workItems: WorkModel[];
  readySelection: ReadyTaskSelection;
}): SandcastlePlanningListPayload {
  const workById = new Map(
    options.workItems.map((item) => [item.id, item] as const),
  );
  const selectableIds = new Set(
    options.readySelection.candidates.map((candidate) => candidate.id),
  );
  const exclusionsById = exclusionMap(options.readySelection);

  const selectable = options.readySelection.candidates
    .map((candidate) => workById.get(candidate.id))
    .filter((item): item is WorkModel => Boolean(item))
    .map((item) => ({
      ...toPlanningEntry(item),
      lane: "selectable" as const,
    }));

  const horizon = options.workItems
    .filter((item) => !selectableIds.has(item.id))
    .map((item) => {
      const exclusion = exclusionsById.get(item.id);
      const reasonCodes = [
        ...new Set(exclusion?.reasons.map((reason) => reason.code) ?? ["not_selectable"]),
      ];
      return {
        ...toPlanningEntry(item),
        lane: "horizon" as const,
        reasonCodes,
        reasons: exclusion?.reasons ?? [],
        findings: exclusion?.findings ?? [],
      };
    })
    .sort(comparePlanningEntries);

  return {
    schemaVersion: "dv4sandcastle-list/v1",
    selectable,
    horizon,
  };
}

export async function loadSandcastlePlanningListPayload(
  options: LoadSandcastlePlanningListOptions = {},
): Promise<SandcastlePlanningListPayload> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const backlogDir = options.backlogDir ?? "backlog";
  const [workItems, readySelection] = await Promise.all([
    listWorkModels({ rootDir, backlogDir }),
    selectReadyWorkItems({ rootDir, backlogDir }),
  ]);
  return buildSandcastlePlanningListPayload({
    workItems: workItems.sort(comparePlanningEntries),
    readySelection,
  });
}
