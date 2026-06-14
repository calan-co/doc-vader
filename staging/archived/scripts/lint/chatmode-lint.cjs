#!/usr/bin/env node

/**

- Validates chatmode files for structure, accessibility, and completeness
-
- Validates:
- - YAML frontmatter structure
- - Required sections (agent, persona, commands, etc.)
- - Dependency file accessibility
- - Command definitions
- - Activation instructions
- - File path resolution
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const CHATMODES_DIR = path.join(__dirname, "../../.github/chatmodes");
const PROJECT_ROOT = path.join(__dirname, "../..");

// Required sections in chatmode YAML block
const REQUIRED_SECTIONS = {
  agent: ["name", "id", "title", "icon", "whenToUse"],
  persona: ["role", "style", "identity", "focus", "core_principles"],
  commands: true, // Just needs to exist
  dependencies: false, // Optional but validated if present
};

// Required activation instructions patterns
const REQUIRED_ACTIVATION_PATTERNS = [
  /STEP 1.*Read THIS ENTIRE FILE/i,
  /STEP 2.*Adopt the persona/i,
  /STEP 3.*Load.*core-config\.yaml/i,
  /STEP 4.*Greet.*help/i,
];

function extractYamlBlock(content) {
  // Find YAML block within markdown code fence
  const yamlMatch = content.match(/```yaml\n([\s\S]*?)\n```/);
  if (!yamlMatch) {
    return { error: "No YAML block found (expected ```yaml...```)" };
  }

  try {
    const yamlContent = yaml.load(yamlMatch[1]);
    return { yaml: yamlContent };
  } catch (err) {
    return { error: `YAML parse error: ${err.message}` };
  }
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { error: "No frontmatter found" };
  }

  try {
    const frontmatter = yaml.load(match[1]);
    return { frontmatter };
  } catch (err) {
    return { error: `Frontmatter parse error: ${err.message}` };
  }
}

function validateAgent(agent, errors, filename) {
  if (!agent) {
    errors.push("Missing required section: agent");
    return;
  }

  for (const field of REQUIRED_SECTIONS.agent) {
    if (!agent[field]) {
      errors.push(`agent.${field} is required but missing`);
    }
  }

  // Validate icon is an emoji (basic check)
  if (agent.icon && !/[\u{1F000}-\u{1F9FF}]/u.test(agent.icon)) {
    errors.push(`agent.icon should be an emoji (found: "${agent.icon}")`);
  }

  // Validate id matches filename
  if (agent.id) {
    const expectedFilename = `${agent.id}.chatmode.md`;
    if (filename !== expectedFilename) {
      errors.push(
        `agent.id "${agent.id}" doesn't match filename "${filename}" (expected: ${expectedFilename})`
      );
    }
  }
}

function validatePersona(persona, errors) {
  if (!persona) {
    errors.push("Missing required section: persona");
    return;
  }

  for (const field of REQUIRED_SECTIONS.persona) {
    if (!persona[field]) {
      errors.push(`persona.${field} is required but missing`);
    }
  }

  // Validate core_principles is an array with at least one item
  if (persona.core_principles) {
    if (!Array.isArray(persona.core_principles)) {
      errors.push("persona.core_principles must be an array");
    } else if (persona.core_principles.length === 0) {
      errors.push(
        "persona.core_principles must contain at least one principle"
      );
    }
  }
}

function validateCommands(commands, errors) {
  if (!commands) {
    errors.push("Missing required section: commands");
    return;
  }

  if (!Array.isArray(commands) && typeof commands !== "object") {
    errors.push("commands must be an array or object");
    return;
  }

  // Check for required commands
  const commandList = Array.isArray(commands)
    ? commands.map((c) =>
        typeof c === "string" ? c.split(":")[0] : Object.keys(c)[0]
      )
    : Object.keys(commands);

  if (!commandList.includes("help")) {
    errors.push('commands must include "help" command');
  }

  if (!commandList.includes("exit")) {
    errors.push('commands must include "exit" command');
  }

  // Validate command format
  if (Array.isArray(commands)) {
    commands.forEach((cmd, idx) => {
      if (typeof cmd === "string") {
        if (!cmd.includes(":")) {
          errors.push(
            `Command at index ${idx} missing description (format: "command: description")`
          );
        }
      } else if (typeof cmd === "object") {
        const keys = Object.keys(cmd);
        if (keys.length === 0) {
          errors.push(`Command at index ${idx} is empty object`);
        }
      }
    });
  }
}

function validateDependencies(dependencies, errors, chatmodeDir) {
  if (!dependencies) {
    return; // Dependencies are optional
  }

  if (typeof dependencies !== "object") {
    errors.push(
      "dependencies must be an object with categories (tasks, templates, data, etc.)"
    );
    return;
  }

  // Check each dependency file exists
  for (const [category, files] of Object.entries(dependencies)) {
    if (!Array.isArray(files)) {
      errors.push(`dependencies.${category} must be an array of file paths`);
      continue;
    }

    files.forEach((file) => {
      // Resolve file path
      let resolvedPath;

      // Check if it's a relative path starting with ../
      if (file.startsWith("../")) {
        resolvedPath = path.resolve(chatmodeDir, file);
      }
      // Check if it's a .bmad-core path
      else if (file.startsWith(".bmad-core/")) {
        resolvedPath = path.join(PROJECT_ROOT, file);
      }
      // Assume it's relative to .bmad-core/{category}/
      else {
        resolvedPath = path.join(PROJECT_ROOT, ".bmad-core", category, file);
      }

      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        errors.push(
          `Dependency file not accessible: ${file} (resolved to: ${resolvedPath})`
        );
      }
    });
  }
}

function validateActivationInstructions(content, errors) {
  const hasActivationSection = content.includes("activation-instructions:");

  if (!hasActivationSection) {
    errors.push("Missing activation-instructions section in YAML block");
    return;
  }

  // Check for required patterns
  REQUIRED_ACTIVATION_PATTERNS.forEach((pattern, idx) => {
    if (!pattern.test(content)) {
      errors.push(
        `Missing required activation step pattern ${idx + 1}: ${pattern.source}`
      );
    }
  });

  // Check for STAY IN CHARACTER
  if (!content.includes("STAY IN CHARACTER")) {
    errors.push(
      'Missing "STAY IN CHARACTER" reminder in activation instructions'
    );
  }

  // Check for halt instruction
  if (!content.includes("HALT") && !content.includes("halt")) {
    errors.push(
      "Missing HALT instruction (chatmode should halt after greeting and *help)"
    );
  }
}

function validateFrontmatter(frontmatter, errors) {
  if (!frontmatter) {
    return; // Already reported as error
  }

  if (!frontmatter.description) {
    errors.push("Frontmatter missing required field: description");
  }

  if (!frontmatter.tools || !Array.isArray(frontmatter.tools)) {
    errors.push("Frontmatter missing or invalid field: tools (must be array)");
  }
}

function validateChatmode(filePath, filename) {
  const content = fs.readFileSync(filePath, "utf8");
  const errors = [];
  const warnings = [];

  // Validate frontmatter
  const { frontmatter, error: frontmatterError } = extractFrontmatter(content);
  if (frontmatterError) {
    errors.push(frontmatterError);
  } else {
    validateFrontmatter(frontmatter, errors);
  }

  // Validate YAML block
  const { yaml: yamlBlock, error: yamlError } = extractYamlBlock(content);
  if (yamlError) {
    errors.push(yamlError);
    return { errors, warnings }; // Can't continue without YAML
  }

  // Validate required sections
  validateAgent(yamlBlock.agent, errors, filename);
  validatePersona(yamlBlock.persona, errors);
  validateCommands(yamlBlock.commands, errors);
  validateDependencies(yamlBlock.dependencies, errors, path.dirname(filePath));

  // Validate activation instructions
  validateActivationInstructions(content, errors);

  // Check for BMAD™ Core attribution
  if (!content.includes("Powered by BMAD™ Core")) {
    warnings.push('Missing "Powered by BMAD™ Core" attribution');
  }

  // Check for REQUEST-RESOLUTION guidance
  if (!content.includes("REQUEST-RESOLUTION")) {
    warnings.push(
      "Missing REQUEST-RESOLUTION guidance (helps AI match user requests to commands)"
    );
  }

  // Check for IDE-FILE-RESOLUTION
  if (yamlBlock.dependencies && !content.includes("IDE-FILE-RESOLUTION")) {
    warnings.push("Has dependencies but missing IDE-FILE-RESOLUTION guidance");
  }

  // Check filename convention
  if (!filename.endsWith(".chatmode.md")) {
    errors.push("Filename must end with .chatmode.md");
  }

  return { errors, warnings };
}

function main() {
  console.log("🤖 Validating chatmode files...\n");

  if (!fs.existsSync(CHATMODES_DIR)) {
    console.error(`❌ Chatmodes directory not found: ${CHATMODES_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(CHATMODES_DIR)
    .filter((f) => f.endsWith(".chatmode.md"));

  if (files.length === 0) {
    console.log("⚠️  No chatmode files found");
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesChecked = 0;

  for (const file of files) {
    const filePath = path.join(CHATMODES_DIR, file);
    const { errors, warnings } = validateChatmode(filePath, file);
    filesChecked++;

    if (errors.length > 0) {
      console.error(`\n❌ ${file}:`);
      errors.forEach((err) => console.error(`   • ${err}`));
      totalErrors += errors.length;
    }

    if (warnings.length > 0) {
      console.warn(`\n⚠️  ${file}:`);
      warnings.forEach((warn) => console.warn(`   • ${warn}`));
      totalWarnings += warnings.length;
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`✅ ${file}`);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`Files checked: ${filesChecked}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);

  if (totalErrors > 0) {
    console.error(`\n❌ ${totalErrors} validation errors found`);
    console.error("   Fix errors and run again\n");
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log(`\n⚠️  ${totalWarnings} warnings (non-blocking)\n`);
  } else {
    console.log("\n✅ All chatmodes are valid!\n");
  }
}

main();
