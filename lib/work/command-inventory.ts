import { inspectWorkActionPolicy } from "../work-management/frontmatter-lint.js";

export interface WorkCommandInventoryEntry {
  readonly name: string;
  readonly children: readonly WorkCommandInventoryEntry[];
}

export interface WorkCommandInventoryNode {
  readonly path: readonly string[];
  readonly children: readonly string[];
}

type WorkCommandInventoryDefinition = {
  readonly name: string;
  readonly children?: readonly WorkCommandInventoryDefinition[];
};

function freezeWorkCommandInventory(
  entries: readonly WorkCommandInventoryDefinition[],
): readonly WorkCommandInventoryEntry[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        name: entry.name,
        children: freezeWorkCommandInventory(entry.children ?? []),
      }),
    ),
  );
}

function workCommandTree(): readonly WorkCommandInventoryDefinition[] {
  let actions: { name: string }[] = [];
  try {
    actions = inspectWorkActionPolicy().actions.map((action) => ({
      name: action.verb,
    }));
  } catch {
    // ponytail: inventory remains useful when optional action policy loading fails.
  }
  return [
    {
      name: "graph",
      children: [
        { name: "summary" },
        { name: "export" },
        { name: "visualize" },
        { name: "nodes" },
        { name: "edges" },
        { name: "inspect" },
      ],
    },
    { name: "list" },
    { name: "ready" },
    { name: "capabilities" },
    { name: "select" },
    { name: "show" },
    { name: "status" },
    { name: "prompt" },
    { name: "claim" },
    { name: "recover" },
    { name: "reconcile-merged" },
    { name: "release-reconciled" },
    { name: "reconcile-direct-push" },
    ...actions,
    { name: "record" },
  ];
}

export const WORK_COMMAND_ALIASES = Object.freeze([
  "work",
  "wi",
  "task",
] as const);

let workCommandInventory: readonly WorkCommandInventoryEntry[] | undefined;

export function getWorkCommandInventory(): readonly WorkCommandInventoryEntry[] {
  return (workCommandInventory ??= freezeWorkCommandInventory(workCommandTree()));
}

export function* iterWorkCommandInventory(
  entries: readonly WorkCommandInventoryEntry[] = getWorkCommandInventory(),
  prefix: readonly string[] = [],
): Generator<WorkCommandInventoryNode> {
  for (const entry of entries) {
    const path = Object.freeze([...prefix, entry.name]);
    const children = Object.freeze(entry.children.map((child) => child.name));
    yield {
      path,
      children,
    };
    yield* iterWorkCommandInventory(entry.children, path);
  }
}
