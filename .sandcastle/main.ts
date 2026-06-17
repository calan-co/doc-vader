// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (10 iterations). If it produces commits, a
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
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      branch: z.string(),
      mode: z.enum(["fresh", "recovered"]).default("fresh"),
      claimId: z.string().optional(),
      recovery: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

const sandcastleConfigDir = path.dirname(fileURLToPath(import.meta.url));

const loadDotEnv = (envPath = path.join(sandcastleConfigDir, ".env")) => {
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(
      trimmed,
    );
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

loadDotEnv();

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;
const AGENT_IDLE_TIMEOUT_SECONDS = 300;
const HOST_SANDCASTLE_CACHE = path.join(os.homedir(), ".cache", "doc-vader", "sandcastle");
const HOST_PNPM_STORE = path.join(HOST_SANDCASTLE_CACHE, "pnpm-store-linux");
const HOST_CLAIM_STORE_DIR = path.join(HOST_SANDCASTLE_CACHE, "claims");
const HOST_CLAIM_STORE = path.join(HOST_CLAIM_STORE_DIR, "task-claims.json");
const HOST_CODEX_AUTH = path.join(os.homedir(), ".codex", "auth.json");
const HOST_CODEX_CONFIG = path.join(os.homedir(), ".codex", "config.toml");
const HOST_SANDBOX_CODEX_HOME = path.join(HOST_SANDCASTLE_CACHE, "codex-home");
const SANDBOX_PNPM_STORE = "/home/agent/.cache/pnpm/store";
const SANDBOX_CLAIM_STORE_DIR = "/home/agent/.cache/doc-vader/claims";
const SANDBOX_CLAIM_STORE = `${SANDBOX_CLAIM_STORE_DIR}/task-claims.json`;
const SANDBOX_CODEX_HOME = "/home/agent/.codex";
const CODEX_MODEL = process.env.SANDCASTLE_CODEX_MODEL ?? "gpt-5.4-mini";

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

fs.mkdirSync(HOST_PNPM_STORE, { recursive: true });
fs.mkdirSync(HOST_CLAIM_STORE_DIR, { recursive: true });
fs.mkdirSync(HOST_SANDBOX_CODEX_HOME, { recursive: true });
if (!fs.existsSync(HOST_CLAIM_STORE)) {
  fs.writeFileSync(HOST_CLAIM_STORE, '{"claims":[]}\n', "utf8");
}
fs.copyFileSync(HOST_CODEX_AUTH, path.join(HOST_SANDBOX_CODEX_HOME, "auth.json"));
fs.copyFileSync(HOST_CODEX_CONFIG, path.join(HOST_SANDBOX_CODEX_HOME, "config.toml"));
fs.chmodSync(path.join(HOST_SANDBOX_CODEX_HOME, "auth.json"), 0o600);
fs.chmodSync(path.join(HOST_SANDBOX_CODEX_HOME, "config.toml"), 0o600);

const SANDCASTLE_RUN_ID =
  process.env.SANDCASTLE_RUN_ID ?? `sandcastle-${Date.now()}`;
const SANDCASTLE_CLAIM_HOLDER = `sandcastle:${SANDCASTLE_RUN_ID}`;

const codexAgent = () =>
  sandcastle.codex(CODEX_MODEL);

const releaseTaskClaim = (taskId: string) => {
  try {
    execFileSync(
      "node",
      [
        "--import",
        "tsx",
        "scripts/sandcastle/dv-adapter.ts",
        "release-task",
        taskId,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          TMPDIR: "/tmp",
          DOC_VADER_TASK_CLAIM_STORE: HOST_CLAIM_STORE,
          SANDCASTLE_CLAIM_HOLDER,
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    console.log(`Released claim for ${taskId} after no-commit implementation.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not release claim for ${taskId}: ${message}`);
  }
};

const branchHasCommits = (branch: string) => {
  try {
    const count = execFileSync("git", ["rev-list", "--count", `HEAD..${branch}`], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return Number(count) > 0;
  } catch {
    return false;
  }
};

// Hooks run inside the sandbox before the agent starts each iteration.
// pnpm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: {
    onSandboxReady: [
      {
        // Sandcastle may run hook entries concurrently, so keep dependent setup
        // steps in one shell command: build requires the install to complete.
        // Keep Nx runtime state out of host-owned .nx paths inside rootless
        // sandboxes, where those paths can be visible but unwritable.
        command:
          'export TMPDIR=/tmp NX_DAEMON=false NX_CACHE_DIRECTORY=/tmp/doc-vader-nx-cache NX_WORKSPACE_DATA_DIRECTORY=/tmp/doc-vader-nx-workspace-data; codex login status >/dev/null && CI=true pnpm install --frozen-lockfile --prefer-offline --store-dir "$SANDCASTLE_PNPM_STORE_PATH" && CI=true pnpm run build',
      },
    ],
  },
};

const sandboxProvider = podman({
  mounts: [
    {
      hostPath: HOST_PNPM_STORE,
      sandboxPath: SANDBOX_PNPM_STORE,
    },
    {
      hostPath: HOST_CLAIM_STORE_DIR,
      sandboxPath: SANDBOX_CLAIM_STORE_DIR,
    },
    {
      hostPath: HOST_SANDBOX_CODEX_HOME,
      sandboxPath: SANDBOX_CODEX_HOME,
    },
  ],
  env: {
    CI: "true",
    TMPDIR: "/tmp",
    CODEX_HOME: SANDBOX_CODEX_HOME,
    NX_DAEMON: "false",
    NX_CACHE_DIRECTORY: "/tmp/doc-vader-nx-cache",
    NX_WORKSPACE_DATA_DIRECTORY: "/tmp/doc-vader-nx-workspace-data",
    SANDCASTLE_PNPM_STORE_PATH: SANDBOX_PNPM_STORE,
    DOC_VADER_TASK_CLAIM_STORE: SANDBOX_CLAIM_STORE,
    SANDCASTLE_CLAIM_HOLDER,
  },
});

// Do not copy host node_modules into Linux sandboxes; native packages may be
// platform-specific. The hook above installs dependencies inside the sandbox.
const copyToWorktree: string[] = [];

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
    hooks,
    sandbox: sandboxProvider,
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    idleTimeoutSeconds: AGENT_IDLE_TIMEOUT_SECONDS,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: codexAgent(),
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
        sandbox: sandboxProvider,
        hooks,
        copyToWorktree,
      });
      let producedCommits = false;

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 10,
          idleTimeoutSeconds: AGENT_IDLE_TIMEOUT_SECONDS,
          agent: codexAgent(),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
            MODE: issue.mode,
            CLAIM_ID: issue.claimId ?? "",
            RECOVERY_CONTEXT: issue.recovery
              ? JSON.stringify(issue.recovery, null, 2)
              : "{}",
          },
        });
        producedCommits = implement.commits.length > 0;
        const shouldReview =
          producedCommits ||
          (issue.mode === "recovered" && branchHasCommits(issue.branch));

        // Only review if the implementer produced commits
        if (shouldReview) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            idleTimeoutSeconds: AGENT_IDLE_TIMEOUT_SECONDS,
            agent: codexAgent(),
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
        if (!producedCommits && !branchHasCommits(issue.branch)) {
          releaseTaskClaim(issue.id);
        }
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
        (entry.outcome.value.commits.length > 0 ||
          (entry.issue.mode === "recovered" &&
            branchHasCommits(entry.issue.branch))),
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
    hooks,
    sandbox: sandboxProvider,
    name: "merger",
    maxIterations: 1,
    idleTimeoutSeconds: AGENT_IDLE_TIMEOUT_SECONDS,
    agent: codexAgent(),
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
