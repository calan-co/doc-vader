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
  return Object.freeze(entries.map((entry) => Object.freeze({
    name: entry.name,
    children: freezeWorkCommandInventory(entry.children ?? []),
  })));
}

const WORK_COMMAND_TREE = [
  { name: "list" },
  { name: "ready" },
  {
    name: "<work-item-id>",
    children: [
      { name: "show" },
      { name: "status" },
      { name: "update" },
      { name: "prompt" },
      { name: "claim", children: [{ name: "<claim-token>", children: [{ name: "release" }] }] },
      { name: "recover" },
      { name: "repair-generated-evidence" },
      { name: "record" },
      { name: "checklist", children: [{ name: "<checklist-id>", children: [{ name: "check", children: [{ name: "<check-id>", children: [{ name: "complete" }, { name: "clear" }] }] }] }] },
    ],
  },
] as const satisfies readonly WorkCommandInventoryDefinition[];

export const WORK_COMMAND_ALIASES = Object.freeze(["work"] as const);

export const WORK_COMMAND_INVENTORY = freezeWorkCommandInventory(WORK_COMMAND_TREE);

export function* iterWorkCommandInventory(
  entries: readonly WorkCommandInventoryEntry[] = WORK_COMMAND_INVENTORY,
  prefix: readonly string[] = [],
): Generator<WorkCommandInventoryNode> {
  for (const entry of entries) {
    const path = Object.freeze([...prefix, entry.name]);
    const children = Object.freeze(entry.children.map((child) => child.name));
    yield { path, children };
    yield* iterWorkCommandInventory(entry.children, path);
  }
}
