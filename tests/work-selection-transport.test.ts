import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsxImport = pathToFileURL(require.resolve("tsx")).href;
const cliPath = path.resolve(__dirname, "../cli/doc-vader.ts");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "dv-selection-transport-"),
  );
  roots.push(root);
  await fs.mkdir(path.join(root, "backlog"), { recursive: true });
  await fs.writeFile(
    path.join(root, "backlog", "001-ready.md"),
    `---
id: wi-001
title: Ready item
summary: Transport fixture
type: work-item
subtype: task
lifecycle: active
status: ready
tags:
  - afk
---
`,
    "utf8",
  );
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "transport@example.test"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Transport Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: root,
    stdio: "ignore",
  });
  return root;
}

function invokeText(root: string, args: string[], input?: string): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxImport, cliPath, "work", ...args],
    {
      cwd: root,
      input,
      encoding: "utf8",
    },
  );
}

function invoke(root: string, args: string[], input?: string): unknown {
  return JSON.parse(invokeText(root, args, input));
}

function expectInvalidBacklogDir(root: string, backlogDir: string): void {
  let output = "";
  try {
    invoke(
      root,
      [
        "select",
        "wi-001",
        "--request",
        "-",
        "--backlog-dir",
        backlogDir,
        "--json",
      ],
      JSON.stringify({
        capability: "publisher-work-selection/v1",
        request: { workItemId: "wi-001", invocationContext: {} },
      }),
    );
  } catch (error) {
    const result = error as { stdout?: unknown; stderr?: unknown };
    output = `${String(result.stdout)}${String(result.stderr)}`;
  }
  expect(output).toContain("TASK_SELECTION_INVALID_BACKLOG_DIR");
}

describe("publisher work selection CLI transport", () => {
  it("discovers the versioned capability through JSON without importing Doc-Vader", async () => {
    const root = await fixture();
    expect(invoke(root, ["capabilities", "wi-001", "--json"])).toEqual({
      schemaVersion: "publisher-work-selection-discovery/v1",
      capabilities: ["publisher-work-selection/v1"],
      versionMappings: [
        {
          requestedCapability: "publisher-work-selection/v1",
          responseCapability: "publisher-work-selection/v1",
        },
      ],
    });
  });

  it("fails closed when the scoped resource and request identity differ", async () => {
    const root = await fixture();
    expect(() =>
      invoke(
        root,
        ["select", "wi-other", "--request", "-", "--json"],
        JSON.stringify({
          capability: "publisher-work-selection/v1",
          request: { workItemId: "wi-001", invocationContext: {} },
        }),
      ),
    ).toThrow();
  });

  it("reports a null JSON request as a scoped-resource mismatch", async () => {
    const root = await fixture();
    try {
      invoke(root, ["select", "wi-001", "--request", "-", "--json"], "null");
      throw new Error("expected selection command to fail");
    } catch (error) {
      const output = error as { stdout?: unknown; stderr?: unknown };
      expect(`${String(output.stdout)}${String(output.stderr)}`).toContain(
        "TASK_SELECTION_RESOURCE_MISMATCH",
      );
    }
  });

  it("renders a human selection result unless --json is requested", async () => {
    const root = await fixture();
    expect(
      invokeText(
        root,
        ["select", "wi-001", "--request", "-", "--backlog-dir", "backlog"],
        JSON.stringify({
          capability: "publisher-work-selection/v1",
          request: { workItemId: "wi-001", invocationContext: {} },
        }),
      ),
    ).toBe("selected wi-001\n");
  });

  it("keeps root-level body-relationship dependencies when --backlog-dir is .", async () => {
    const root = await fixture();
    await fs.writeFile(
      path.join(root, "002-root-blocking.md"),
      `---
id: wi-002
title: Root blocking item
summary: Transport fixture root dependency
type: work-item
subtype: task
lifecycle: active
status: in-progress
tags:
  - afk
---
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "003-root-dependent.md"),
      `---
id: wi-003
title: Root dependent item
summary: Transport fixture root dependent
type: work-item
subtype: task
lifecycle: active
status: ready
tags:
  - afk
---

## Relationships

- \`depends_on\`: [[wi-002]]
`,
      "utf8",
    );

    expect(
      invoke(
        root,
        ["select", "wi-003", "--request", "-", "--backlog-dir", ".", "--json"],
        JSON.stringify({
          capability: "publisher-work-selection/v1",
          request: { workItemId: "wi-003", invocationContext: {} },
        }),
      ),
    ).toMatchObject({
      outcome: { kind: "not-selected", code: "NOT_READY" },
    });
  });

  it("excludes configured backlog archive, audit, and records subtrees when --backlog-dir is .", async () => {
    const root = await fixture();
    for (const [directory, id, code] of [
      ["archive", "wi-archive", "NOT_READY"],
      ["audit", "wi-audit", "NOT_FOUND"],
      ["records", "wi-records", "NOT_FOUND"],
    ]) {
      await fs.mkdir(path.join(root, "backlog", directory), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(root, "backlog", directory, `${id}.md`),
        `---
id: ${id}
title: Excluded ${directory}
type: work-item
subtype: task
lifecycle: active
status: ready
tags:
  - afk
---
`,
        "utf8",
      );
      expect(
        invoke(
          root,
          ["select", id, "--request", "-", "--backlog-dir", ".", "--json"],
          JSON.stringify({
            capability: "publisher-work-selection/v1",
            request: { workItemId: id, invocationContext: {} },
          }),
        ),
      ).toMatchObject({ outcome: { kind: "not-selected", code } });
    }
  });

  it("keeps body-relationship dependencies when --backlog-dir is absolute", async () => {
    const root = await fixture();
    await fs.writeFile(
      path.join(root, "backlog", "002-blocking.md"),
      `---
id: wi-002
title: Blocking item
summary: Transport fixture dependency
type: work-item
subtype: task
lifecycle: active
status: in-progress
tags:
  - afk
---
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "backlog", "003-dependent.md"),
      `---
id: wi-003
title: Dependent item
summary: Transport fixture dependent
type: work-item
subtype: task
lifecycle: active
status: ready
tags:
  - afk
---

## Relationships

- \`depends_on\`: [[wi-002]]
`,
      "utf8",
    );

    expect(
      invoke(
        root,
        [
          "select",
          "wi-003",
          "--request",
          "-",
          "--backlog-dir",
          path.join(root, "backlog"),
          "--json",
        ],
        JSON.stringify({
          capability: "publisher-work-selection/v1",
          request: { workItemId: "wi-003", invocationContext: {} },
        }),
      ),
    ).toMatchObject({
      outcome: { kind: "not-selected", code: "NOT_READY" },
    });
  });

  it("rejects a relative --backlog-dir traversal before readiness selection", async () => {
    const root = await fixture();
    expectInvalidBacklogDir(root, "..");
  });

  it("rejects an in-root --backlog-dir symlink that resolves outside the command root", async () => {
    const root = await fixture();
    const external = await fs.mkdtemp(
      path.join(os.tmpdir(), "dv-selection-external-"),
    );
    roots.push(external);
    await fs.symlink(external, path.join(root, "external-backlog"), "dir");

    expectInvalidBacklogDir(root, "external-backlog");
  });

  it("selects a requested ready identity through stdin JSON and emits only the transport contract", async () => {
    const root = await fixture();
    const response = invoke(
      root,
      ["select", "wi-001", "--request", "-", "--json"],
      JSON.stringify({
        capability: "publisher-work-selection/v1",
        request: {
          workItemId: "wi-001",
          invocationContext: { caller: "node20-consumer" },
        },
      }),
    ) as Record<string, unknown>;

    expect(response).toMatchObject({
      capability: "publisher-work-selection/v1",
      outcome: { kind: "selected", workItemId: "wi-001" },
      decisionArtifact: {
        invokedCommand: "dv work select wi-001 --request - --json",
        requestedWorkItemId: "wi-001",
      },
    });
    expect(response).not.toHaveProperty("candidates");
    expect(JSON.stringify(response)).not.toContain("task-ready/v1");
  });
});
