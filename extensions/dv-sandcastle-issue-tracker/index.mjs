import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TRACKER_COMMAND = "node .sandcastle/dv4sandcastle.mjs";
const SENTINEL = "echo 'No issue tracker configured — run .sandcastle/SETUP_ISSUE_TRACKER.md through your coding agent.' >&2; exit 1";

export function registerDocVaderExtension(program, context = { cwd: process.cwd() }) {
  const sandcastle = getOrCreateCommand(program, "sandcastle", "Sandcastle integration helpers");

  sandcastle
    .command("init")
    .description("Configure a Sandcastle scaffold to use Doc-Vader as its issue tracker")
    .option("--root <dir>", "Workspace root to configure", context.cwd)
    .option(
      "--run-sandcastle-init",
      "Run `npx @ai-hero/sandcastle init` before patching the scaffold",
    )
    .option("--dry-run", "Report changes without writing files")
    .option("--json", "Print a machine-readable summary")
    .allowUnknownOption(true)
    .argument(
      "[sandcastleArgs...]",
      "Additional arguments for `npx @ai-hero/sandcastle init`; pass after --",
    )
    .action((sandcastleArgs, options) => {
      const result = runInit({
        root: options.root,
        dryRun: Boolean(options.dryRun),
        json: Boolean(options.json),
        runSandcastleInit: Boolean(options.runSandcastleInit),
        sandcastleArgs,
      });
      printResult(result, Boolean(options.json));
    });
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = runInit(options);
  printResult(result, options.json);
}

export function runInit(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const sandcastleArgs = options.sandcastleArgs ?? [];

  if (options.runSandcastleInit && !options.dryRun) {
    run("npx", ["@ai-hero/sandcastle", "init", ...sandcastleArgs], root);
  }

  return {
    root,
    dryRun: Boolean(options.dryRun),
    sandcastleInit: {
      requested: Boolean(options.runSandcastleInit),
      command: ["npx", "@ai-hero/sandcastle", "init", ...sandcastleArgs].join(" "),
    },
    changes: configure(root, Boolean(options.dryRun)),
  };
}

function getOrCreateCommand(program, name, description) {
  const existing = program.commands.find((command) => command.name() === name);
  if (existing) {
    return existing;
  }
  return program.command(name).description(description);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    dryRun: false,
    json: false,
    runSandcastleInit: false,
    sandcastleArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.sandcastleArgs.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--root") {
      options.root = argv[++index] ?? fail("--root requires a directory");
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--run-sandcastle-init") {
      options.runSandcastleInit = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      options.sandcastleArgs.push(arg);
    }
  }
  return options;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.dryRun ? "Would configure" : "Configured"} Doc-Vader Sandcastle issue tracker at ${result.root}`);
  for (const change of result.changes) {
    console.log(`- ${change.action} ${change.path}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage: dv-sandcastle-init [options] [-- sandcastle init args]

Configure an existing Sandcastle scaffold to use Doc-Vader as its custom issue tracker.

Options:
  --root <dir>              Workspace root to configure (default: cwd)
  --run-sandcastle-init     Run npx @ai-hero/sandcastle init before patching
  --dry-run                 Report changes without writing files
  --json                    Print machine-readable summary
  -h, --help                Show help

Examples:
  npx @ai-hero/sandcastle init
  npx @calan-co/dv-sandcastle-issue-tracker

  npx @calan-co/dv-sandcastle-issue-tracker --run-sandcastle-init -- --template parallel-planner`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, TMPDIR: process.env.TMPDIR ?? "/tmp" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeFile(root, relativePath, content, dryRun) {
  const absolutePath = path.join(root, relativePath);
  const existed = existsSync(absolutePath);
  if (!dryRun) {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  return { path: relativePath, action: existed ? "update" : "create" };
}

function patchMarkdownFile(root, relativePath, dryRun) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return null;
  const before = readFileSync(absolutePath, "utf8");
  let after = before
    .replaceAll(SENTINEL, `${TRACKER_COMMAND} list`)
    .replaceAll("<view command — see .sandcastle/SETUP_ISSUE_TRACKER.md>", `${TRACKER_COMMAND} view`)
    .replaceAll("<close command — see .sandcastle/SETUP_ISSUE_TRACKER.md>", `${TRACKER_COMMAND} close`);

  after = after
    .replaceAll("<view command - see .sandcastle/SETUP_ISSUE_TRACKER.md>", `${TRACKER_COMMAND} view`)
    .replaceAll("<close command - see .sandcastle/SETUP_ISSUE_TRACKER.md>", `${TRACKER_COMMAND} close`);

  if (after === before) return null;
  if (!dryRun) writeFileSync(absolutePath, after, "utf8");
  return { path: relativePath, action: "patch" };
}

function configure(root, dryRun) {
  const sandcastleDir = path.join(root, ".sandcastle");
  if (!existsSync(sandcastleDir) && !dryRun) {
    mkdirSync(sandcastleDir, { recursive: true });
  }

  const changes = [
    writeFile(root, ".sandcastle/dv4sandcastle.mjs", adapterSource(), dryRun),
    writeFile(root, ".sandcastle/close.mjs", closeTaskSource(), dryRun),
    writeFile(root, ".sandcastle/SETUP_ISSUE_TRACKER.md", setupGuide(), dryRun),
  ];

  for (const fileName of [
    "plan-prompt.md",
    "implement-prompt.md",
    "merge-prompt.md",
    "review-prompt.md",
  ]) {
    const change = patchMarkdownFile(root, `.sandcastle/${fileName}`, dryRun);
    if (change) changes.push(change);
  }

  for (const change of [
    patchMainFile(root, dryRun),
    patchContainerfile(root, dryRun),
    patchGitignore(root, dryRun),
  ]) {
    if (change) changes.push(change);
  }

  return changes;
}

function patchMainFile(root, dryRun) {
  const relativePath = ".sandcastle/main.ts";
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return null;
  const before = readFileSync(absolutePath, "utf8");
  let after = before;

  if (!after.includes('import { mkdirSync } from "node:fs";')) {
    after = after.replace(
      'import * as sandcastle from "@ai-hero/sandcastle";',
      'import { mkdirSync } from "node:fs";\nimport * as sandcastle from "@ai-hero/sandcastle";',
    );
  }

  if (!after.includes("process.env.DV_COMMAND ??=")) {
    after = after.replace(
      'import { z } from "zod";\n',
      'import { z } from "zod";\n\n// Use the project-local Doc-Vader CLI on both host prompt preprocessing and\n// inside sandbox commands. `dv` is not globally installed/published here.\nprocess.env.DV_COMMAND ??= "node --import tsx cli/doc-vader.ts";\nprocess.env.DV_SANDCASTLE_CLOSE_COMMAND ??= "node .sandcastle/close.mjs";\n',
    );
  }

  after = after.replace(
    '// Hooks run inside the sandbox before the agent starts each iteration.\n// npm install ensures the sandbox always has fresh dependencies.\nconst hooks = {\n  sandbox: { onSandboxReady: [{ command: "npm install" }] },\n};\n\n// Copy node_modules from the host into the worktree before each sandbox\n// starts. Avoids a full npm install from scratch; the hook above handles\n// platform-specific binaries and any packages added since the last copy.\nconst copyToWorktree = ["node_modules"];\n',
    '// Hooks run inside the sandbox before the agent starts each iteration.\n// The install hook ensures the sandbox always has fresh dependencies.\nconst hooks = {\n  sandbox: { onSandboxReady: [{ command: "CI=true pnpm install" }] },\n};\n\n// Mount a dedicated Linux node_modules directory over the worktree\'s\n// node_modules path. Sandcastle bind-mounts the worktree, so running pnpm in a\n// Linux container would otherwise overwrite the host macOS dependencies with\n// Linux native packages such as esbuild.\nmkdirSync(".sandcastle/cache/node_modules", { recursive: true });\nconst sandboxProvider = podman({\n  mounts: [\n    {\n      hostPath: ".sandcastle/cache/node_modules",\n      sandboxPath: "/home/agent/workspace/node_modules",\n    },\n    {\n      hostPath: "~/.codex/auth.json",\n      sandboxPath: "/home/agent/.codex/auth.json",\n      readonly: true,\n    },\n    {\n      hostPath: "~/.codex/config.toml",\n      sandboxPath: "/home/agent/.codex/config.toml",\n      readonly: true,\n    },\n    {\n      hostPath: "~/.pi/agent/auth.json",\n      sandboxPath: "/home/agent/.pi/agent/auth.json",\n      readonly: true,\n    },\n    {\n      hostPath: "~/.pi/agent/settings.json",\n      sandboxPath: "/home/agent/.pi/agent/settings.json",\n      readonly: true,\n    },\n    {\n      hostPath: "~/.pi/agent/permissions.json",\n      sandboxPath: "/home/agent/.pi/agent/permissions.json",\n      readonly: true,\n    },\n    {\n      hostPath: "~/.pi/agent/trust.json",\n      sandboxPath: "/home/agent/.pi/agent/trust.json",\n      readonly: true,\n    },\n  ],\n});\n\nconst plannerAgent = sandcastle.pi("openai-codex/gpt-5.4", { thinking: "high" });\nconst implementerAgent = sandcastle.pi("openai-codex/gpt-5.4-mini", { thinking: "medium" });\nconst reviewerAgent = sandcastle.pi("openai-codex/gpt-5.4", { thinking: "high" });\nconst mergerAgent = sandcastle.pi("openai-codex/gpt-5.4", { thinking: "medium" });\n',
  );
  after = after.replaceAll("sandbox: podman(),", "sandbox: sandboxProvider,");
  after = after.replaceAll("        copyToWorktree,\n", "");
  after = after.replace(
    '// Opus for planning: dependency analysis benefits from deeper reasoning.\n    agent: sandcastle.codex("gpt-5.4"),',
    '// Use Pi so Sandcastle invokes the configured CLI-backed provider instead\n    // of the direct Codex API path.\n    agent: plannerAgent,',
  );
  after = after.replace(
    'agent: sandcastle.codex("gpt-5.4"),\n          promptFile: "./.sandcastle/implement-prompt.md",',
    'agent: implementerAgent,\n          promptFile: "./.sandcastle/implement-prompt.md",',
  );
  after = after.replace(
    'agent: sandcastle.codex("gpt-5.4"),\n            promptFile: "./.sandcastle/review-prompt.md",',
    'agent: reviewerAgent,\n            promptFile: "./.sandcastle/review-prompt.md",',
  );
  after = after.replace(
    'agent: sandcastle.codex("gpt-5.4"),\n    promptFile: "./.sandcastle/merge-prompt.md",',
    'agent: mergerAgent,\n    promptFile: "./.sandcastle/merge-prompt.md",',
  );

  if (after === before) return null;
  if (!dryRun) writeFileSync(absolutePath, after, "utf8");
  return { path: relativePath, action: "patch" };
}

function patchContainerfile(root, dryRun) {
  const relativePath = ".sandcastle/Containerfile";
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return null;
  const before = readFileSync(absolutePath, "utf8");
  let after = before;
  if (!after.includes("npm install -g pnpm@")) {
    after = after.replace(
      "# TODO: install your issue tracker's CLI here. See .sandcastle/SETUP_ISSUE_TRACKER.md\n",
      "# Enable pnpm for sandbox dependency hooks.\nRUN corepack disable && npm install -g pnpm@\n\n# TODO: install your issue tracker's CLI here. See .sandcastle/SETUP_ISSUE_TRACKER.md\n",
    );
  }
  if (after.includes("RUN npm install -g @openai/codex") && !after.includes("@earendil-works/pi-coding-agent")) {
    after = after.replace(
      "# Install Codex CLI (run as root before USER agent)\nRUN npm install -g @openai/codex\n",
      "# Install agent CLIs (run as root before USER agent).\n# Pi is used as the Sandcastle agent provider; Codex remains available for\n# Pi configurations that delegate to the Codex CLI/auth stack.\n# The wrapper starts Pi without user extensions because host extensions may\n# depend on packages that are not installed in the sandbox image.\nRUN npm install -g @earendil-works/pi-coding-agent @openai/codex \\\n  && mv /usr/local/bin/pi /usr/local/bin/pi-real \\\n  && printf '#!/usr/bin/env sh\\nexec /usr/local/bin/pi-real -ne \"$@\"\\n' > /usr/local/bin/pi \\\n  && chmod +x /usr/local/bin/pi\n",
    );
  }
  if (after === before) return null;
  if (!dryRun) writeFileSync(absolutePath, after, "utf8");
  return { path: relativePath, action: "patch" };
}

function patchGitignore(root, dryRun) {
  const relativePath = ".sandcastle/.gitignore";
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) return null;
  const before = readFileSync(absolutePath, "utf8");
  let after = before;
  if (!after.includes("cache/")) {
    after = `${after.replace(/\s*$/, "\n")}cache/\n`;
  }
  if (after === before) return null;
  if (!dryRun) writeFileSync(absolutePath, after, "utf8");
  return { path: relativePath, action: "patch" };
}

function setupGuide() {
  return `# Doc-Vader Sandcastle Issue Tracker

This Sandcastle scaffold is configured by \`dv-sandcastle-init\` or \`dv sandcastle init\` to use Doc-Vader work items as the custom issue tracker.

## Commands

- List open AFK-ready work: \`${TRACKER_COMMAND} list\`
- View one work item: \`${TRACKER_COMMAND} view <task-id>\`
- Validate close readiness: \`${TRACKER_COMMAND} validate <task-id>\`
- Render implementation context: \`${TRACKER_COMMAND} prompt <task-id>\`
- Claim work before editing: \`${TRACKER_COMMAND} claim <task-id> --holder <holder> --branch <branch> --json\`
- Record evidence: \`${TRACKER_COMMAND} record --claim <claim-id> --type <record-type> --payload <json-file|-> --json\`
- Recover interrupted work: \`${TRACKER_COMMAND} recover <task-id> --branch <branch> --json\`
- Close work: \`${TRACKER_COMMAND} close <task-id>\`

## Requirements

- Doc-Vader must be available either from source at \`cli/doc-vader.ts\` or as \`dv\` in the workspace.
- Override the command used by the adapter with \`DV_COMMAND\` when needed, for example \`DV_COMMAND=\"pnpm exec dv\"\`.
- Closing uses \`.sandcastle/close.mjs\` by default. Override with \`DV_SANDCASTLE_CLOSE_COMMAND\` when your repo has a different terminal transition script.

## Update Flow

Run \`dv sandcastle init\` again after regenerating the Sandcastle scaffold or changing Doc-Vader command policy.
`;
}

function closeTaskSource() {
  return `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const [taskId, ...extraArgs] = process.argv.slice(2);

if (!taskId) {
  console.error("Usage: close <task-id>");
  process.exit(1);
}

function defaultDvCommand() {
  return existsSync("cli/doc-vader.ts") ? "node --import tsx cli/doc-vader.ts" : "dv";
}

const dvCommand = process.env.DV_COMMAND ?? defaultDvCommand();
const numericId = taskId.replace(/^wi-/, "");

${splitCommandSource()}

try {
  const [command, ...baseArgs] = splitCommand(dvCommand);
  execFileSync(
    command,
    [
      ...baseArgs,
      "work",
      numericId,
      "update",
      "--input",
      JSON.stringify({ status: "completed", statusReason: "completed" }),
      ...extraArgs,
    ],
    { stdio: "inherit", env: { ...process.env, CI: "true" }, timeout: 120_000 },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
}

function splitCommandSource() {
  return `function splitCommand(command) {
  const result = [];
  let current = "";
  let quote = null;
  for (const char of command) {
    if ((char === "'" || char === '\"') && quote === null) { quote = char; continue; }
    if (char === quote) { quote = null; continue; }
    if (/\\s/.test(char) && quote === null) {
      if (current) result.push(current), current = "";
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
}`;
}

function adapterSource() {
  return `#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function defaultDvCommand() {
  return existsSync("cli/doc-vader.ts") ? "node --import tsx cli/doc-vader.ts" : "dv";
}

const dvCommand = process.env.DV_COMMAND ?? defaultDvCommand();

function splitCommand(command) {
  const result = [];
  let current = "";
  let quote = null;
  for (const char of command) {
    if ((char === "'" || char === '\"') && quote === null) { quote = char; continue; }
    if (char === quote) { quote = null; continue; }
    if (/\\s/.test(char) && quote === null) {
      if (current) result.push(current), current = "";
      continue;
    }
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function runDv(args, input) {
  const [command, ...baseArgs] = splitCommand(dvCommand);
  return execFileSync(command, [...baseArgs, ...args], {
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
    env: { ...process.env, CI: "true", TMPDIR: process.env.TMPDIR ?? "/tmp" },
  });
}

function optionalStdin() {
  return process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseJsonFromCommandOutput(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    for (const match of raw.matchAll(/[\\[{]/g)) {
      try {
        return JSON.parse(raw.slice(match.index));
      } catch {
        // Keep scanning: pnpm and lifecycle hooks can prefix stdout with
        // bracketed log lines before the actual JSON payload.
      }
    }
    throw new Error(\`Command did not emit JSON: \${raw}\`);
  }
}

function normalizeReadyList(raw) {
  const parsed = parseJsonFromCommandOutput(raw);
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates ?? parsed.selectable ?? [];
  return candidates.map((candidate) => ({
    id: String(candidate.id ?? \`wi-\${candidate.numericId ?? candidate.number}\`),
    title: candidate.title ?? candidate.summary ?? String(candidate.id ?? candidate.number),
    body: candidate.body ?? candidate.summary ?? "",
    status: candidate.status,
    priority: candidate.priority,
    filePath: candidate.filePath,
    branch: candidate.branch ?? \`sandcastle/issue-\${candidate.numericId ?? candidate.id ?? candidate.number}\`,
  }));
}

const [command, ...args] = process.argv.slice(2);
try {
  switch (command) {
    case "list":
      console.log(JSON.stringify(normalizeReadyList(runDv(["work", "ready", "--json", ...args])), null, 2));
      break;
    case "view":
      if (!args[0]) fail("Usage: dv4sandcastle view <task-id>");
      process.stdout.write(runDv(["work", args[0], "show", "--json"]));
      break;
    case "validate":
      if (!args[0]) fail("Usage: dv4sandcastle validate <task-id> [status flags]");
      process.stdout.write(runDv(["work", args[0], "status", ...args.slice(1)]));
      break;
    case "prompt":
      if (!args[0]) fail("Usage: dv4sandcastle prompt <task-id>");
      process.stdout.write(runDv(["work", args[0], "prompt"]));
      break;
    case "claim":
      if (!args[0]) fail("Usage: dv4sandcastle claim <task-id> [claim flags]");
      process.stdout.write(runDv(["work", args[0], "claim", ...args.slice(1)]));
      break;
    case "recover":
      if (!args[0]) fail("Usage: dv4sandcastle recover <task-id> [recover flags]");
      process.stdout.write(runDv(["work", args[0], "recover", ...args.slice(1)]));
      break;
    case "record": {
      const claimIndex = args.findIndex((arg) => arg === "--claim" || arg.startsWith("--claim="));
      const claimToken = claimIndex < 0 ? undefined : args[claimIndex] === "--claim" ? args[claimIndex + 1] : args[claimIndex].slice("--claim=".length);
      if (!claimToken) fail("Usage: dv4sandcastle record --claim <claim-token> --type <record-type> --payload <json-file|->");
      const claimStatus = parseJsonFromCommandOutput(runDv(["claim", "status", claimToken, "--json"]));
      const taskId = claimStatus?.claim?.target_type === "task" ? claimStatus.claim.target_id : undefined;
      if (!taskId) fail("Record claim must target a Work Item.");
      process.stdout.write(runDv(["work", taskId, "record", ...args], optionalStdin()));
      break;
    }
    case "close": {
      if (!args[0]) fail("Usage: dv4sandcastle close <task-id> [close flags]");
      const closeCommand = process.env.DV_SANDCASTLE_CLOSE_COMMAND;
      if (!closeCommand) {
        fail("DV_SANDCASTLE_CLOSE_COMMAND is required for close because terminal transition policy is repository-specific.");
      }
      const result = spawnSync(closeCommand, args, { shell: true, stdio: "inherit", env: process.env });
      process.exit(result.status ?? 1);
      break;
    }
    default:
      fail("Usage: dv4sandcastle <list|view|validate|prompt|claim|recover|record|close> [...args]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
}
