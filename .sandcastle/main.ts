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
const PNPM_INSTALL_COMMAND = `CI=true COREPACK_HOME=${SANDBOX_COREPACK_CACHE} corepack pnpm install --frozen-lockfile --store-dir ${SANDBOX_PNPM_STORE}`;

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

fs.mkdirSync(HOST_COREPACK_CACHE, { recursive: true });
fs.mkdirSync(HOST_PNPM_STORE, { recursive: true });
fs.mkdirSync(HOST_ROOT_NODE_MODULES, { recursive: true });
fs.mkdirSync(HOST_SANDBOX_CODEX_HOME, { recursive: true });
fs.copyFileSync(HOST_CODEX_AUTH, path.join(HOST_SANDBOX_CODEX_HOME, "auth.json"));
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
    onSandboxReady: [{ command: PNPM_INSTALL_COMMAND }],
  },
};

// Branch worktrees are separate directories under .sandcastle/worktrees. Remove
// stale copied node_modules there, then let Linux pnpm recreate dependencies.
const worktreeHooks = {
  host: {
    onWorktreeReady: [
      {
        command:
          'case "$PWD" in */.sandcastle/worktrees/*) rm -rf node_modules ;; *) echo "Refusing to remove node_modules outside .sandcastle/worktrees: $PWD" >&2; exit 1 ;; esac',
      },
    ],
  },
  sandbox: {
    onSandboxReady: [
      {
        command: PNPM_INSTALL_COMMAND,
      },
    ],
  },
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
    agent: sandcastle.codex("gpt-5.4-mini"),
    promptFile: "./.sandcastle/plan-prompt.md",
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;

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

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: worktreeSandbox(),
        hooks: worktreeHooks,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.codex("gpt-5.4-mini"),
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
            agent: sandcastle.codex("gpt-5.4-mini"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
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
    agent: sandcastle.codex("gpt-5.4-mini"),
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
