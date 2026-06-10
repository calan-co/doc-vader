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
import { execSync } from "node:child_process";
import { z } from "zod";

const AUTH_MODE = process.env.SANDCASTLE_AUTH_MODE?.trim() || "cli";

const codexAgentEnv =
  AUTH_MODE === "api-key"
    ? undefined
    : {
        CODEX_API_KEY: "",
        OPENAI_API_KEY: "",
        OPENAI_KEY: "",
      };

const codexAgent = () =>
  sandcastle.codex("gpt-5.4-mini", {
    env: codexAgentEnv,
  });

function preflightCodexAuth(): void {
  const codexApiKey = process.env.CODEX_API_KEY?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const legacyOpenAiKey = process.env.OPENAI_KEY?.trim();

  if (AUTH_MODE !== "api-key") {
    delete process.env.CODEX_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_KEY;

    try {
      execSync("codex login status", { stdio: "pipe" });
    } catch {
      throw new Error(
        "Codex CLI login not detected. Run 'codex login' or set SANDCASTLE_AUTH_MODE=api-key with CODEX_API_KEY/OPENAI_API_KEY.",
      );
    }
    return;
  }

  if (!codexApiKey && !openAiApiKey && legacyOpenAiKey) {
    process.env.CODEX_API_KEY = legacyOpenAiKey;
    process.env.OPENAI_API_KEY = legacyOpenAiKey;
    return;
  }

  if (!codexApiKey && !openAiApiKey) {
    throw new Error(
      "Missing Codex API key auth. Set CODEX_API_KEY or OPENAI_API_KEY in .sandcastle/.env, or use the default CLI login mode.",
    );
  }
}

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

// Generous timeout overrides to survive Podman startup latency and agents
// that go silent while waiting on subprocesses.
const timeouts = {
  // Default is 10 s; raise to 60 s so slow Podman container startup doesn't
  // abort the git config safe.directory step under load.
  gitSetupMs: 60_000,
};

// Idle timeout in seconds — resets on every agent output event.
// Default is 600 (10 min); 1800 (30 min) gives long-running tasks more room.
const IDLE_TIMEOUT_SECONDS = 1800;

// Hooks run inside the sandbox before the agent starts each iteration.
// pnpm install ensures the sandbox always has fresh dependencies.
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "CI=true pnpm install --frozen-lockfile", timeoutMs: 300_000 },
    ],
  },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

const sandboxProvider = podman({
  mounts: [
    {
      hostPath: "~/.codex",
      sandboxPath: "/home/agent/.codex",
    },
  ],
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

preflightCodexAuth();

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plan: any;
  try {
    plan = await sandcastle.run({
      hooks,
      sandbox: sandboxProvider,
      name: "planner",
      // One iteration is enough: the planner just needs to read and reason,
      // not write code. (Structured output requires maxIterations: 1.)
      maxIterations: 1,
      // Opus for planning: dependency analysis benefits from deeper reasoning.
      agent: codexAgent(),
      promptFile: "./.sandcastle/plan-prompt.md",
      timeouts,
      idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
      // Extract and validate the <plan> JSON into a typed object. Throws
      // StructuredOutputError if the tag is missing, the JSON is malformed, or
      // validation fails — which aborts the loop.
      output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
    });
  } catch (err) {
    console.error(
      `\n[planner] Failed on iteration ${iteration}/${MAX_ITERATIONS}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    console.log(
      "Stopping loop — completed iterations may have merged successfully.",
    );
    break;
  }

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
        timeouts,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: codexAgent(),
          promptFile: "./.sandcastle/implement-prompt.md",
          timeouts,
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
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
            agent: codexAgent(),
            promptFile: "./.sandcastle/review-prompt.md",
            timeouts,
            idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
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
    hooks,
    sandbox: sandboxProvider,
    name: "merger",
    maxIterations: 1,
    agent: codexAgent(),
    promptFile: "./.sandcastle/merge-prompt.md",
    timeouts,
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
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
