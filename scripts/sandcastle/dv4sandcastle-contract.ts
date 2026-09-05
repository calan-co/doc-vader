export interface SandcastleAdapterCommandContract {
  name:
    | "list"
    | "view"
    | "prompt"
    | "claim-task"
    | "recover-task"
    | "record-task"
    | "close-task"
    | "lock-status";
  usage: string;
  requiredArgs: string[];
  optionalFlags: string[];
  output: "json" | "text";
  expectation: string;
}

export const sandcastleAdapterContract = {
  schemaVersion: "dv4sandcastle-contract/v1",
  commands: [
    {
      name: "list",
      usage: "dv4sandcastle list",
      requiredArgs: [],
      optionalFlags: [],
      output: "json",
      expectation: "schemaVersion=dv4sandcastle-list/v1",
    },
    {
      name: "view",
      usage: "dv4sandcastle view <task-id>",
      requiredArgs: ["task-id"],
      optionalFlags: [],
      output: "json",
      expectation: "canonical work item JSON from dv work <id> show",
    },
    {
      name: "prompt",
      usage: "dv4sandcastle prompt <task-id>",
      requiredArgs: ["task-id"],
      optionalFlags: [],
      output: "text",
      expectation: "implementation prompt text from dv work <id> prompt",
    },
    {
      name: "claim-task",
      usage: "dv4sandcastle claim-task <task-id> [claim flags]",
      requiredArgs: ["task-id"],
      optionalFlags: ["--holder", "--branch", "--json"],
      output: "json",
      expectation: "runtime claim result from the Sandcastle adapter",
    },
    {
      name: "recover-task",
      usage: "dv4sandcastle recover-task <task-id> [recover flags]",
      requiredArgs: ["task-id"],
      optionalFlags: ["--branch", "--force", "--json"],
      output: "json",
      expectation: "runtime recovery result from the Sandcastle adapter",
    },
    {
      name: "record-task",
      usage: "dv4sandcastle record-task [record flags]",
      requiredArgs: [],
      optionalFlags: ["--claim", "--type", "--payload", "--json"],
      output: "json",
      expectation: "work record result from the Sandcastle adapter",
    },
    {
      name: "close-task",
      usage: "dv4sandcastle close-task <task-id> [close flags]",
      requiredArgs: ["task-id"],
      optionalFlags: ["--claim", "--payload", "--record-type"],
      output: "json",
      expectation:
        "repository transition and release result from the Sandcastle adapter",
    },
    {
      name: "lock-status",
      usage: "dv4sandcastle lock-status [lock flags]",
      requiredArgs: [],
      optionalFlags: ["--claim", "--json"],
      output: "json",
      expectation: "runtime claim and lock status",
    },
  ] as const satisfies readonly SandcastleAdapterCommandContract[],
} as const;

export function getSandcastleAdapterCommandContract(
  name: SandcastleAdapterCommandContract["name"],
): SandcastleAdapterCommandContract {
  const command = sandcastleAdapterContract.commands.find(
    (candidate) => candidate.name === name,
  );
  if (!command) {
    throw new Error(`Unknown Sandcastle adapter contract command: ${name}`);
  }
  return command;
}

export function formatSandcastleAdapterUsage(): string {
  return [
    "Usage: dv4sandcastle <command> [args...]",
    "",
    "Commands:",
    ...sandcastleAdapterContract.commands.map(
      (command) => `- ${command.usage}`,
    ),
  ].join("\n");
}
