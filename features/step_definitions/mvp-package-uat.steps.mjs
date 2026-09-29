import { After, Given, Then, When } from "@cucumber/cucumber";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.cwd();
let consumer;
let packageVersion;
let packed;

function run(command, args, options) {
  return execFileSync(command, args, { shell: process.platform === "win32", ...options });
}

function packageManager(...args) {
  return run(process.execPath, [process.env.npm_execpath, ...args], { cwd: repo, encoding: "utf8" });
}

function npm(...args) {
  const cli = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  return run(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8" });
}

function dv(...args) {
  return run("node", ["node_modules/@calan-co/doc-vader/dist/cli/doc-vader.js", ...args], {
    cwd: consumer,
    encoding: "utf8",
  });
}

Given("a clean consumer project with a ready work item", () => {
  consumer = mkdtempSync(path.join(os.tmpdir(), "doc-vader-cucumber-"));
  mkdirSync(path.join(consumer, "backlog"));
  writeFileSync(path.join(consumer, ".npmrc"), "registry=https://registry.npmjs.org/\n@calan-co:registry=https://npm.pkg.github.com/\n");
  writeFileSync(path.join(consumer, "package.json"), '{"name":"mvp-uat","private":true}\n');
  writeFileSync(path.join(consumer, "backlog/100-mvp-uat.md"), `---
id: wi-100
title: MVP UAT
type: work-item
subtype: task
lifecycle: active
status: ready
priority: medium
tags:
  - afk
---

## Tasks

- [ ] Verify the installed package.
`);
});

When("I install the packed Doc-Vader package", () => {
  packageManager("run", "build");
  packed = JSON.parse(npm("pack", "--ignore-scripts", "--json"))[0].filename;
  try {
    run(process.execPath, [path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"), "install", path.join(repo, packed)], { cwd: consumer, stdio: "inherit" });
    packageVersion = JSON.parse(readFileSync(path.join(consumer, "node_modules/@calan-co/doc-vader/package.json"), "utf8")).version;
  } finally {
    rmSync(path.join(repo, packed), { force: true });
  }
});

Then("the CLI reports its installed package version", () => {
  if (dv("--version").trim() !== packageVersion) throw new Error("CLI version differs from installed package version");
});

Then("the ready work item is discoverable", () => {
  const ready = JSON.parse(dv("work", "ready", "--json"));
  if (!ready.candidates.some((item) => item.id === "wi-100")) throw new Error("ready work item was not discovered");
});

Then("the ready work item prompt renders", () => {
  const prompt = dv("work", "prompt", "wi-100");
  if (!prompt.includes("# Work Item: wi-100") || !prompt.includes("MVP UAT")) throw new Error("work item prompt did not render task content");
});

After(() => {
  if (packed) rmSync(path.join(repo, packed), { force: true });
  if (consumer) rmSync(consumer, { recursive: true, force: true });
});
