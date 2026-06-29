export interface WorkCommandInventoryEntry {
  readonly name: string;
  readonly children: readonly WorkCommandInventoryEntry[];
}

export interface WorkCommandInventoryNode {
  readonly path: readonly string[];
  readonly children: readonly string[];
}

type MutableWorkCommandInventoryEntry = {
  readonly name: string;
  readonly children?: readonly MutableWorkCommandInventoryEntry[];
};

function freezeInventory(
  entries: readonly MutableWorkCommandInventoryEntry[],
): readonly WorkCommandInventoryEntry[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        name: entry.name,
        children: freezeInventory(entry.children ?? []),
      }),
    ),
  );
}

const WORK_COMMAND_TREE = [
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
  { name: "show" },
  { name: "status" },
  { name: "prompt" },
  { name: "claim" },
  { name: "recover" },
  { name: "record" },
] as const satisfies readonly MutableWorkCommandInventoryEntry[];

export const WORK_COMMAND_ALIASES = Object.freeze(["work", "wi", "task"] as const);

export const WORK_COMMAND_INVENTORY = freezeInventory(WORK_COMMAND_TREE);

export function* iterWorkCommandInventory(
  entries: readonly WorkCommandInventoryEntry[] = WORK_COMMAND_INVENTORY,
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
