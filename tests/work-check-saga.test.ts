import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Saga,
  SagaInterruption,
  SagaOrchestrator,
  SagaStore,
  createFileCommand,
} from "../lib/work-management/saga.js";

const authority = { taskId: "wi-saga", claimToken: "active-claim" };
const authorized = { authorize: async () => undefined };

const roots: string[] = [];

async function setup() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-saga-"));
  roots.push(rootDir);
  const first = path.join(rootDir, "record.md");
  const second = path.join(rootDir, "work.md");
  await fs.writeFile(second, "unchecked", "utf8");
  return { rootDir, first, second };
}

async function saga(rootDir: string, id: string, first: string, second: string, firstContent = "evidence") {
  return new Saga({
    id,
    authority,
    commands: await Promise.all([
      createFileCommand({ rootDir, sagaId: id, filePath: first, content: firstContent }),
      createFileCommand({ rootDir, sagaId: id, filePath: second, content: "checked" }),
    ]),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Work evidence/check saga", () => {
  it("records ordered success, idempotent replay, and address-compatible final state", async () => {
    const { rootDir, first, second } = await setup();
    const store = new SagaStore({ rootDir });
    const id = "normal";
    const work = await saga(rootDir, id, first, second);
    const orchestrator = new SagaOrchestrator(store, authorized);

    await expect(orchestrator.execute(work)).resolves.toMatchObject({ status: "completed" });
    await expect(orchestrator.execute(work)).resolves.toMatchObject({ status: "completed" });
    expect(await fs.readFile(first, "utf8")).toBe("evidence");
    expect(await fs.readFile(second, "utf8")).toBe("checked");
    expect(store.history.list(id).filter((fact) => fact.fact === "applied")).toHaveLength(2);
    store.close();
  });

  it.each(["created", "intent", "effect", "applied", "completed"] as const)("recovers a fresh instance after %s", async (boundary) => {
    const { rootDir, first, second } = await setup();
    const id = `interrupt-${boundary}`;
    const interruptedStore = new SagaStore({ rootDir });
    const interrupted = new SagaOrchestrator(interruptedStore, {
      ...authorized,
      afterBoundary(phase) {
        if (phase === boundary) throw new SagaInterruption("process stopped");
      },
    });
    await expect(interrupted.execute(await saga(rootDir, id, first, second))).rejects.toThrow("process stopped");
    interruptedStore.close();

    const recoveredStore = new SagaStore({ rootDir });
    await expect(new SagaOrchestrator(recoveredStore, authorized).recover(id)).resolves.toMatchObject({ status: "completed" });
    expect(await fs.readFile(first, "utf8")).toBe("evidence");
    expect(await fs.readFile(second, "utf8")).toBe("checked");
    recoveredStore.close();
  });

  it("compensates ordinary failure in reverse order", async () => {
    const { rootDir, first, second } = await setup();
    const id = "compensate";
    const work = await saga(rootDir, id, first, second);
    await fs.rm(work.commands[1]!.serialized.stagePath);
    const store = new SagaStore({ rootDir });

    await expect(new SagaOrchestrator(store, authorized).execute(work)).resolves.toMatchObject({ status: "failed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    store.close();
  });

  it.each(["undo-intent", "undone", "failed"] as const)("recovers interrupted %s compensation", async (boundary) => {
    const { rootDir, first, second } = await setup();
    const id = `compensation-${boundary}`;
    const work = await saga(rootDir, id, first, second);
    await fs.rm(work.commands[1]!.serialized.stagePath);
    const interruptedStore = new SagaStore({ rootDir });
    await expect(new SagaOrchestrator(interruptedStore, {
      ...authorized,
      afterBoundary(phase) {
        if (phase === boundary) throw new SagaInterruption("process stopped");
      },
    }).execute(work)).rejects.toThrow("process stopped");
    interruptedStore.close();

    const recoveredStore = new SagaStore({ rootDir });
    await expect(new SagaOrchestrator(recoveredStore, authorized).recover(id)).resolves.toMatchObject({ status: "failed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    recoveredStore.close();
  });

  it("makes conflicting durable state disputed without cleanup", async () => {
    const { rootDir, first, second } = await setup();
    const id = "dispute";
    const work = await saga(rootDir, id, first, second);
    const store = new SagaStore({ rootDir });
    const orchestrator = new SagaOrchestrator(store, {
      ...authorized,
      afterBoundary(phase) {
        if (phase === "intent") return fs.writeFile(first, "external drift", "utf8");
      },
    });

    await expect(orchestrator.execute(work)).resolves.toMatchObject({ status: "disputed" });
    expect(await fs.readFile(work.commands[0]!.serialized.stagePath, "utf8")).toBe("evidence");
    expect(store.history.list(id).at(-1)).toMatchObject({ fact: "disputed" });
    store.close();
  });

  it("disputes pending recovery before a denied claim can resume an effect", async () => {
    const { rootDir, first, second } = await setup();
    const id = "denied-recovery";
    const interruptedStore = new SagaStore({ rootDir });
    await expect(new SagaOrchestrator(interruptedStore, {
      ...authorized,
      afterBoundary(phase) {
        if (phase === "intent") throw new SagaInterruption("process stopped");
      },
    }).execute(await saga(rootDir, id, first, second))).rejects.toThrow("process stopped");
    interruptedStore.close();

    const recoveredStore = new SagaStore({ rootDir });
    await expect(new SagaOrchestrator(recoveredStore, {
      authorize: async () => { throw new Error("claim no longer owns work item"); },
    }).recover(id)).resolves.toMatchObject({ status: "disputed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    expect(recoveredStore.history.list(id).at(-1)).toMatchObject({ fact: "authorization-disputed" });
    recoveredStore.close();
  });

  it("rejects traversal paths before staging and recovery access", async () => {
    const { rootDir, first, second } = await setup();
    expect(() => new Saga({ id: "../escape", authority, commands: [] })).toThrow("invalid");
    await expect(createFileCommand({ rootDir, sagaId: "safe", filePath: path.join(rootDir, "..", "escape.md"), content: "evidence" }))
      .rejects.toThrow("outside the saga root");
    await expect(fs.stat(path.join(rootDir, ".doc-vader", "runtime", "sagas", "safe"))).rejects.toMatchObject({ code: "ENOENT" });

    const id = "persisted-traversal";
    const work = await saga(rootDir, id, first, second);
    const store = new SagaStore({ rootDir });
    store.create(work);
    const serialized = [{ ...work.commands[0]!.serialized, stagePath: path.join(rootDir, "..", "escape.next") }];
    store.database.prepare("UPDATE saga_instances SET commands = ? WHERE id = ?").run(JSON.stringify(serialized), id);
    await expect(new SagaOrchestrator(store, authorized).recover(id)).resolves.toMatchObject({ status: "disputed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    expect(store.history.list(id).at(-1)).toMatchObject({ fact: "path-disputed" });
    store.close();
  });

  it.each(["target", "stage", "backup"] as const)("disputes a persisted %s symlink escape before effects", async (escapedPath) => {
    const { rootDir, first, second } = await setup();
    const id = `symlink-${escapedPath}`;
    const work = await saga(rootDir, id, first, second);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "doc-vader-saga-outside-"));
    roots.push(outside);
    const sagaDir = path.join(rootDir, ".doc-vader", "runtime", "sagas", id);
    const link = path.join(escapedPath === "target" ? rootDir : sagaDir, `${escapedPath}-link`);
    await fs.symlink(outside, link);
    const serialized = [{
      ...work.commands[0]!.serialized,
      [`${escapedPath}Path`]: path.join(link, "escape.md"),
    }];
    const store = new SagaStore({ rootDir });
    store.create(work);
    store.database.prepare("UPDATE saga_instances SET commands = ? WHERE id = ?").run(JSON.stringify(serialized), id);

    await expect(new SagaOrchestrator(store, authorized).recover(id)).resolves.toMatchObject({ status: "disputed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    await expect(fs.stat(path.join(outside, "escape.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.history.list(id).at(-1)).toMatchObject({ fact: "path-disputed" });
    store.close();
  });

  it("disputes malformed persisted authority before recovery effects", async () => {
    const { rootDir, first, second } = await setup();
    const id = "malformed-authority";
    const work = await saga(rootDir, id, first, second);
    const store = new SagaStore({ rootDir });
    store.create(work);
    store.database.prepare("UPDATE saga_instances SET authority = ? WHERE id = ?").run("{", id);

    await expect(new SagaOrchestrator(store, authorized).recover(id)).resolves.toMatchObject({ status: "disputed" });
    await expect(fs.stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(second, "utf8")).toBe("unchecked");
    expect(store.history.list(id).at(-1)).toMatchObject({ fact: "authorization-disputed" });
    store.close();
  });
});
