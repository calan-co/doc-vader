// lint-util.js
// Shared utility for markdown lint scripts: file discovery, argument parsing, error reporting
const fs = require("fs");
const path = require("path");

function getMarkdownFilesFromArgs(args, defaultDirs) {
  const files = [];
  if (!args || args.length === 0) {
    for (const dir of defaultDirs) {
      walk(dir, files);
    }
    return files;
  }
  for (const arg of args) {
    const p = path.resolve(process.cwd(), arg);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        const fp = path.join(p, f);
        if (fs.statSync(fp).isDirectory()) continue;
        else if (fp.endsWith(".md")) files.push(fp);
      }
    } else if (fs.existsSync(p) && p.endsWith(".md")) {
      files.push(p);
    }
  }
  return files;
}

function walk(dir, files) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp, files);
    else if (f.endsWith(".md")) files.push(fp);
  }
}

function reportErrors(errors, failMsg, successMsg) {
  if (errors.length) {
    console.error(failMsg);
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  } else {
    console.log(successMsg);
  }
}

module.exports = { getMarkdownFilesFromArgs, reportErrors };
