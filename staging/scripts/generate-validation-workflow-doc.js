#!/usr/bin/env node
/**
 * generate-validation-workflow-doc.js
 *
 * Auto-generates a markdown summary of the validation workflow by extracting JSDoc-style ordered lists from all relevant lint/validation scripts.
 *
 * - Scans scripts/lint/*.js for JSDoc blocks with ordered lists.
 * - Outputs docs/reference/precommit-validation-workflow.md with links to contributing scripts in frontmatter.
 * - Uses a template-based markdown body (like epic.tpl.md).
 * - Run this script after modifying any validation script to keep the doc up-to-date.
 */

const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, 'lint');
const OUTPUT_PATH = path.join(__dirname, '../docs/reference/precommit-validation-workflow.md');

function extractJSDocOrderedList(content) {
  // Extracts the first JSDoc block with an ordered list (1. ... 2. ...)
  const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (!jsdocMatch) return null;
  const block = jsdocMatch[1];
  const lines = block.split('\n').map(l => l.replace(/^\s*\* ?/, ''));
  const ordered = lines.filter(l => /^\d+\. /.test(l));
  return ordered.length ? ordered : null;
}

function getScriptLinks(scripts) {
  return scripts.map(f => ({
    path: `../../scripts/lint/${path.basename(f)}`,
    label: path.basename(f)
  }));
}

function main() {
  const files = fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(SCRIPTS_DIR, f));
  const workflows = [];
  const contributingScripts = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const ordered = extractJSDocOrderedList(content);
    if (ordered) {
      workflows.push({
        script: file,
        steps: ordered
      });
      contributingScripts.push(file);
    }
  }

  // Build frontmatter
  const frontmatter = [
    '---',
    'title: Pre-commit Validation Workflow',
    'type: document',
    'subtype: process',
    'lifecycle: active',
    'status: auto-generated',
    'links:'
  ];
  for (const link of getScriptLinks(contributingScripts)) {
    frontmatter.push(`  - script: "${link.path}"`);
  }
  frontmatter.push('---\n');

  // Build markdown body
  let body = '\n# Pre-commit Validation Workflow\n\n';
  body += 'This document is auto-generated from JSDoc comments in validation scripts. Do not edit manually.\n\n';
  workflows.forEach(wf => {
      body += `## Workflow from \\`${path.basename(wf.script)}\`\n\n`;
    wf.steps.forEach(step => {
      body += `${step}\n`;
    });
    body += '\n';
  });

  fs.writeFileSync(OUTPUT_PATH, frontmatter.join('\n') + body, 'utf8');
  console.log(`Generated: ${OUTPUT_PATH}`);
}

if (require.main === module) main();
