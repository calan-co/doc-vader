#!/usr/bin/env node
// Unified lint CLI for documentation (Commander.js version)
// const { Command } = require("commander");
// const { spawnSync } = require("child_process");

import { Command } from "commander";
import { spawnSync } from "child_process";

// Define available commands and their shell commands
const commands = {
  all: {
    description: "Run all checks (default)",
    cmd: "sh scripts/docs-lint.sh",
  },
  "markdown-style": {
    description: "Validate markdown style",
    cmd: 'npx markdownlint-cli2 "docs/**/*.md" "*.md"',
  },
  naming: {
    description: "Validate naming conventions",
    cmd: "node staging/scripts/lint/naming-conventions-lint.cjs",
  },
  diagram: {
    description: "Validate diagram usage",
    cmd: "node staging/scripts/lint/diagram-lint.cjs",
  },
  crossref: {
    description: "Validate cross-references",
    cmd: "node staging/scripts/lint/crossref-lint.cjs",
  },
  content: {
    description: "Run custom remark-lint content rules",
    cmd: "node staging/scripts/lint/remark-content-rules.cjs",
  },
  anchor: {
    description: "Validate anchor usage (no explicit HTML anchors)",
    cmd: "node staging/scripts/lint/anchor-lint.cjs",
  },
  frontmatter: {
    description: "Validate metadata/frontmatter",
    cmd: "node staging/scripts/lint/frontmatter-lint.cjs",
  },
  template: {
    description: "Validate template structure",
    cmd: "node staging/scripts/lint/template-lint.cjs",
  },
  structure: {
    description: "Validate documentation structure",
    subcommands: {
      folder: {
        description: "Validate folder structure",
        cmd: "node staging/scripts/lint/folder-structure-lint.cjs",
      },
      readme: {
        description: "Validate README structure",
        cmd: "node staging/scripts/lint/readme-structure-lint.cjs",
      },
    },
  },
};

// Extract command and args from a shell command string
function parseShellCmd(cmd) {
  // Simple split, does not handle all shell quoting cases
  const parts = cmd.split(" ");
  return { command: parts[0], args: parts.slice(1) };
}

// Run a shell command synchronously, return exit code
function run(cmd) {
  const { command, args } = parseShellCmd(cmd);
  // Forward extra CLI args (after subcommand) to the underlying script
  const extraArgs = process.argv.slice(3); // node scripts/lint.js <subcommand> ...
  const result = spawnSync(command, [...args, ...extraArgs], {
    stdio: "inherit",
    shell: true,
  });
  return result.status || 0;
}

// Helper to recursively add commands and subcommands
function addCommands(parent, cmdObj, runner = run) {
  for (const [name, value] of Object.entries(cmdObj)) {
    if (value.subcommands) {
      const sub = parent.command(name).description(value.description || "");
      addCommands(sub, value.subcommands, runner);
    } else if (value.cmd) {
      parent
        .command(name)
        .description(value.description)
        .action(() => process.exit(runner(value.cmd)));
    }
  }
}

// Main CLI entrypoint
function main(argv = process.argv, runner = run) {
  const program = new Command();
  program
    .name("lint")
    .description("Unified lint CLI for documentation")
    .version("1.0.0")
    .command("help", { isDefault: true })
    .description("Display help")
    .action(() => {
      program.outputHelp();
      process.exit(0);
    });

  addCommands(program, commands, runner);

  // Find script position for slicing args
  const scriptIdx = argv.findIndex((arg) => arg.endsWith("lint.js"));
  const args = scriptIdx >= 0 ? argv.slice(scriptIdx + 1) : [];

  // Default to "all" if no subcommand is provided
  if (args.length === 0) {
    return runner(commands.all.cmd);
  } else {
    program.parse(argv);
    return 0;
  }
}

if (import.meta.main) {
  process.exit(main());
}

export { commands, addCommands, run, main };
