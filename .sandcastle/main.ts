// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.ts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;
const HOST_SANDBOX_CACHE = ".sandcastle/cache";
const HOST_WORKTREE_DIR = ".sandcastle/worktrees";
const HOST_COREPACK_CACHE = `${HOST_SANDBOX_CACHE}/corepack-linux`;
const HOST_PNPM_STORE = `${HOST_SANDBOX_CACHE}/pnpm-store-linux`;
const HOST_ROOT_NODE_MODULES = `${HOST_SANDBOX_CACHE}/root-node_modules`;
const HOST_CODEX_AUTH = path.join(os.homedir(), ".codex", "auth.json");
const HOST_CODEX_CONFIG = path.join(os.homedir(), ".codex", "config.toml");
const HOST_SANDBOX_CODEX_HOME = `${HOST_SANDBOX_CACHE}/codex-home`;
const SANDBOX_COREPACK_CACHE = "/home/agent/.cache/node/corepack";
const SANDBOX_PNPM_STORE = "/home/agent/.cache/pnpm/store";
const SANDBOX_ROOT_NODE_MODULES = "/home/agent/workspace/node_modules";
const SANDBOX_CODEX_HOME = "/home/agent/.codex";
const SANDBOX_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SANDBOX_NODE = "/usr/local/bin/node";
const SANDBOX_GIT = "/usr/bin/git";
const SANDBOX_COREPACK = "/usr/local/bin/corepack";
const SANDBOX_RG = "/usr/bin/rg";
const SANDBOX_PNPM_COMMAND = `${SANDBOX_COREPACK} pnpm`;
const PNPM_INSTALL_COMMAND = `CI=true NX_DAEMON=false COREPACK_HOME=${SANDBOX_COREPACK_CACHE} ${SANDBOX_PNPM_COMMAND} install --frozen-lockfile --store-dir ${SANDBOX_PNPM_STORE}`;
const SANDBOX_PREFLIGHT_COMMAND = [
  `test -x ${SANDBOX_NODE}`,
  `test -x ${SANDBOX_GIT}`,
  `test -x ${SANDBOX_COREPACK}`,
  `test -x ${SANDBOX_RG}`,
  `test -w ${SANDBOX_COREPACK_CACHE}`,
  `test -w ${SANDBOX_PNPM_STORE}`,
  `printf "sandbox preflight ok: node=%s pnpm=%s\\n" "$(${SANDBOX_NODE} --version)" "$(${SANDBOX_PNPM_COMMAND} --version)"`,
].join(" && ");
const WORKSPACE_TOOL_SHIM_COMMAND = [
  "mkdir -p .tmp-bin node_modules/.bin",
  `printf '%s\\n' '#!/usr/bin/env sh' 'exec ${SANDBOX_PNPM_COMMAND} "$@"' > .tmp-bin/pnpm`,
  "chmod +x .tmp-bin/pnpm",
  "ln -sf ../../.tmp-bin/pnpm node_modules/.bin/pnpm",
  'printf "workspace pnpm shim ok: %s\\n" "$(.tmp-bin/pnpm --version)"',
].join(" && ");
const WORKTREE_NODE_MODULES_CLEANUP_COMMAND =
  'case "$PWD" in /home/agent/workspace) rm -rf node_modules ;; *) echo "Refusing to remove node_modules outside sandbox workspace: $PWD" >&2; exit 1 ;; esac';

const ensureHostCommand = (command: string, args = ["--version"]) => {
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch (error) {
    throw new Error(
      `Sandcastle preflight failed: required host command \`${command}\` is not available or not executable.`,
      { cause: error },
    );
  }
};

const ensureWritableDirectory = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.sandcastle-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok", "utf8");
    fs.unlinkSync(probe);
  } catch (error) {
    throw new Error(
      `Sandcastle preflight failed: cache directory is not writable: ${dir}`,
      { cause: error },
    );
  }
};

const runHostPreflight = () => {
  for (const command of ["git", "node", "corepack", "podman", "rg"]) {
    ensureHostCommand(command);
  }

  if (!fs.existsSync(HOST_CODEX_AUTH)) {
    throw new Error(
      `Codex auth file not found at ${HOST_CODEX_AUTH}. Run \`codex login\` on the host before running Sandcastle.`,
    );
  }

  if (!fs.existsSync(HOST_CODEX_CONFIG)) {
    throw new Error(
      `Codex config file not found at ${HOST_CODEX_CONFIG}. Run \`codex doctor\` or \`codex login\` on the host before running Sandcastle.`,
    );
  }

  for (const dir of [
    HOST_COREPACK_CACHE,
    HOST_PNPM_STORE,
    HOST_ROOT_NODE_MODULES,
    HOST_SANDBOX_CODEX_HOME,
  ]) {
    ensureWritableDirectory(dir);
  }
};

runHostPreflight();

fs.mkdirSync(HOST_COREPACK_CACHE, { recursive: true });
fs.mkdirSync(HOST_PNPM_STORE, { recursive: true });
fs.mkdirSync(HOST_ROOT_NODE_MODULES, { recursive: true });
fs.mkdirSync(HOST_SANDBOX_CODEX_HOME, { recursive: true });
fs.copyFileSync(
  HOST_CODEX_AUTH,
  path.join(HOST_SANDBOX_CODEX_HOME, "auth.json"),
);
fs.copyFileSync(
  HOST_CODEX_CONFIG,
  path.join(HOST_SANDBOX_CODEX_HOME, "config.toml"),
);
fs.chmodSync(path.join(HOST_SANDBOX_CODEX_HOME, "auth.json"), 0o600);
fs.chmodSync(path.join(HOST_SANDBOX_CODEX_HOME, "config.toml"), 0o600);

const sandboxEnv = {
  CI: "true",
  TMPDIR: "/tmp",
  CODEX_HOME: SANDBOX_CODEX_HOME,
  COREPACK_HOME: SANDBOX_COREPACK_CACHE,
  NX_DAEMON: "false",
  PATH: SANDBOX_PATH,
};

const rootSandbox = () =>
  podman({
    env: sandboxEnv,
    mounts: [
      {
        hostPath: HOST_COREPACK_CACHE,
        sandboxPath: SANDBOX_COREPACK_CACHE,
      },
      {
        hostPath: HOST_PNPM_STORE,
        sandboxPath: SANDBOX_PNPM_STORE,
      },
      {
        hostPath: HOST_ROOT_NODE_MODULES,
        sandboxPath: SANDBOX_ROOT_NODE_MODULES,
      },
      {
        hostPath: HOST_SANDBOX_CODEX_HOME,
        sandboxPath: SANDBOX_CODEX_HOME,
      },
    ],
  });

const worktreeSandbox = () =>
  podman({
    env: sandboxEnv,
    mounts: [
      {
        hostPath: HOST_COREPACK_CACHE,
        sandboxPath: SANDBOX_COREPACK_CACHE,
      },
      {
        hostPath: HOST_PNPM_STORE,
        sandboxPath: SANDBOX_PNPM_STORE,
      },
      {
        hostPath: HOST_SANDBOX_CODEX_HOME,
        sandboxPath: SANDBOX_CODEX_HOME,
      },
    ],
  });

// Root-stage sandboxes mount an ignored Linux node_modules directory over the
// host repo's macOS node_modules, so pnpm never mutates the host install.
const rootHooks = {
  sandbox: {
    onSandboxReady: [
      { command: SANDBOX_PREFLIGHT_COMMAND },
      { command: PNPM_INSTALL_COMMAND },
      { command: WORKSPACE_TOOL_SHIM_COMMAND },
    ],
  },
};

// Branch worktrees are separate directories under .sandcastle/worktrees. Remove
// stale copied node_modules from inside the sandbox workspace, then let Linux
// pnpm recreate dependencies.
const worktreeHooks = {
  sandbox: {
    onSandboxReady: [
      { command: WORKTREE_NODE_MODULES_CLEANUP_COMMAND },
      { command: SANDBOX_PREFLIGHT_COMMAND },
      { command: PNPM_INSTALL_COMMAND },
      { command: WORKSPACE_TOOL_SHIM_COMMAND },
    ],
  },
};

const worktreePathForBranch = (branch: string) =>
  path.join(HOST_WORKTREE_DIR, branch.replaceAll("/", "-"));

const worktreeStatus = (branch: string) => {
  const worktreePath = worktreePathForBranch(branch);
  if (!fs.existsSync(worktreePath)) {
    return "";
  }

  return execFileSync("git", ["-C", worktreePath, "status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
};

const assertCleanWorktree = (issue: { id: string; branch: string }) => {
  const status = worktreeStatus(issue.branch);
  if (status === "") {
    return;
  }

  throw new Error(
    `Issue ${issue.id} left uncommitted changes in ${worktreePathForBranch(
      issue.branch,
    )}; refusing to mark it complete or merge it.\n${status}`,
  );
};

const extractSection = (body: string, heading: string) => {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const match = pattern.exec(body);
  if (!match) {
    return "";
  }

  const rest = body.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
};

const checklistState = (body: string, heading: string) => {
  const section = extractSection(body, heading);
  return {
    checked: [...section.matchAll(/^\s*-\s*\[[xX]\]\s+/gm)].length,
    unchecked: [...section.matchAll(/^\s*-\s*\[\s\]\s+/gm)].length,
  };
};

const issueFileForId = (searchRoot: string, id: string) => {
  const backlogDir = path.join(searchRoot, "backlog");
  for (const file of fs.readdirSync(backlogDir).sort()) {
    if (!file.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(backlogDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const frontmatterId = /^id:\s*(.+)$/m
      .exec(content)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/^wi-/, "");

    if (frontmatterId === id || file.startsWith(`${id}-`)) {
      return filePath;
    }
  }

  throw new Error(`Could not find backlog issue ${id} under ${backlogDir}`);
};

const assertIssueCompleteInBranch = (issue: { id: string; branch: string }) => {
  const worktreePath = worktreePathForBranch(issue.branch);
  const issueFile = issueFileForId(worktreePath, issue.id);
  const content = fs.readFileSync(issueFile, "utf8");

  if (!/^status:\s*completed\s*$/m.test(content)) {
    throw new Error(
      `Issue ${issue.id} is not marked completed in ${issue.branch}; completion must be committed on the feature branch before merge.`,
    );
  }

  if (!/^status_reason:\s*completed\s*$/m.test(content)) {
    throw new Error(
      `Issue ${issue.id} is missing status_reason: completed in ${issue.branch}.`,
    );
  }

  if (!/^completed_date:\s*.+$/m.test(content)) {
    throw new Error(
      `Issue ${issue.id} is missing completed_date in ${issue.branch}.`,
    );
  }

  for (const heading of ["Tasks", "Acceptance Criteria"]) {
    const { checked, unchecked } = checklistState(content, heading);
    if (checked === 0 || unchecked > 0) {
      throw new Error(
        `Issue ${issue.id} has incomplete ${heading} checklist evidence in ${issue.branch}.`,
      );
    }
  }
};

const branchExists = (branch: string) => {
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
};

const changedFilesForBranch = (branch: string) => {
  if (!branchExists(branch)) {
    return new Set<string>();
  }

  const files = execFileSync(
    "git",
    ["diff", "--name-only", `HEAD...${branch}`],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);

  return new Set(files);
};

const selectNonOverlappingIssues = <T extends { id: string; branch: string }>(
  issues: T[],
) => {
  const selected: T[] = [];
  const selectedFiles = new Set<string>();

  for (const issue of issues) {
    const changedFiles = changedFilesForBranch(issue.branch);
    const overlap = [...changedFiles].filter((file) => selectedFiles.has(file));
    if (overlap.length > 0) {
      console.log(
        `Deferring ${issue.id} because ${issue.branch} overlaps already selected files: ${overlap.join(
          ", ",
        )}`,
      );
      continue;
    }

    selected.push(issue);
    for (const file of changedFiles) {
      selectedFiles.add(file);
    }
  }

  return selected;
};

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    hooks: rootHooks,
    sandbox: rootSandbox(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: sandcastle.codex("gpt-5.4"),
    promptFile: "./.sandcastle/plan-prompt.md",
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = selectNonOverlappingIssues(plan.output.issues);

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const issueSandboxes: Array<{
    issue: (typeof issues)[number];
    sandbox: Awaited<ReturnType<typeof sandcastle.createSandbox>>;
  }> = [];

  try {
    for (const issue of issues) {
      console.log(`Preparing sandbox for ${issue.id} on ${issue.branch}`);
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: worktreeSandbox(),
        hooks: worktreeHooks,
      });

      issueSandboxes.push({ issue, sandbox });
    }
  } catch (error) {
    await Promise.allSettled(
      issueSandboxes.map(({ sandbox }) => sandbox.close()),
    );
    throw error;
  }

  const settled = await Promise.allSettled(
    issueSandboxes.map(async ({ issue, sandbox }) => {
      console.log(`Starting pipeline for ${issue.id} on ${issue.branch}`);

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.codex("gpt-5.4"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.codex("gpt-5.4"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });

          assertCleanWorktree(issue);
          assertIssueCompleteInBranch(issue);

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        assertCleanWorktree(issue);
        assertIssueCompleteInBranch(issue);

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const issue = issueSandboxes[i]!.issue;
      console.error(
        `  ✗ ${issue.id} (${issue.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issueSandboxes[i]!.issue }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await sandcastle.run({
    hooks: rootHooks,
    sandbox: rootSandbox(),
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.codex("gpt-5.4"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
