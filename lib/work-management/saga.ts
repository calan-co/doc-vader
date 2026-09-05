import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { openRuntimeSqliteStore, type RuntimeSqliteStore } from "../runtime/index.js";

export type SagaStatus = "running" | "compensating" | "completed" | "failed" | "disputed";
export type SagaPhase = "created" | "intent" | "effect" | "applied" | "undo-intent" | "undone" | "completed" | "failed" | "disputed";

export interface SagaAuthority {
  readonly taskId: string;
  readonly claimToken?: string;
}

export interface SagaInstance {
  readonly id: string;
  readonly status: SagaStatus;
  readonly phase: SagaPhase;
  readonly commandIndex: number;
  readonly revision: number;
  readonly commands: readonly SerializedFileCommand[];
  /** Claim context is revalidated before any pending participant resumes. */
  readonly authority?: SagaAuthority;
}

export interface SagaExecutionFact {
  readonly sagaId: string;
  readonly revision: number;
  readonly phase: SagaPhase;
  readonly commandIndex: number;
  readonly fact: string;
  readonly detail?: string;
}

export class SagaInterruption extends Error {}
export class SagaDisputeError extends Error {}

/** The only persisted command form for the two-file Work evidence transaction. */
export interface SerializedFileCommand {
  readonly kind: "file";
  readonly targetPath: string;
  readonly stagePath: string;
  readonly backupPath: string;
  readonly expectedHash?: string;
  readonly desiredHash: string;
}

export interface Command {
  readonly serialized: SerializedFileCommand;
  canExecute(): Promise<boolean>;
  execute(): Promise<void>;
  canUndo(): Promise<boolean>;
  undo(): Promise<void>;
  dispute(): Promise<string>;
  cleanup(): Promise<void>;
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertSagaId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new Error(`Saga ID '${id}' is invalid.`);
  }
}

function assertPathWithin(rootDir: string, candidate: string, label: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Saga ${label} path is outside the saga root.`);
  }
  return resolved;
}

async function assertPathHasNoSymlinkEscape(rootDir: string, candidate: string, label: string): Promise<void> {
  const root = await fs.realpath(rootDir);
  let existing = path.resolve(candidate);
  while (true) {
    try {
      const resolved = await fs.realpath(existing);
      const relative = path.relative(root, resolved);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Saga ${label} path escapes the saga root through a symlink.`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

function sagaDirectory(rootDir: string, sagaId: string): string {
  assertSagaId(sagaId);
  return path.join(path.resolve(rootDir), ".doc-vader", "runtime", "sagas", sagaId);
}

async function assertCommandPaths(rootDir: string, sagaId: string, command: SerializedFileCommand): Promise<void> {
  const targetPath = assertPathWithin(rootDir, command.targetPath, "target");
  const sagaDir = sagaDirectory(rootDir, sagaId);
  const stagePath = assertPathWithin(sagaDir, command.stagePath, "stage");
  const backupPath = assertPathWithin(sagaDir, command.backupPath, "backup");
  await Promise.all([
    assertPathHasNoSymlinkEscape(rootDir, targetPath, "target"),
    assertPathHasNoSymlinkEscape(rootDir, stagePath, "stage"),
    assertPathHasNoSymlinkEscape(rootDir, backupPath, "backup"),
  ]);
}

async function contentHash(filePath: string): Promise<string | undefined> {
  try {
    return hash(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

class FileCommand implements Command {
  constructor(readonly serialized: SerializedFileCommand) {}

  async canExecute(): Promise<boolean> {
    const current = await contentHash(this.serialized.targetPath);
    return current === this.serialized.desiredHash || current === this.serialized.expectedHash;
  }

  async execute(): Promise<void> {
    const current = await contentHash(this.serialized.targetPath);
    if (current === this.serialized.desiredHash) return;
    if (current !== this.serialized.expectedHash) {
      throw new SagaDisputeError(await this.dispute());
    }
    try {
      await fs.rename(this.serialized.stagePath, this.serialized.targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && await contentHash(this.serialized.targetPath) === this.serialized.desiredHash) return;
      throw error;
    }
  }

  async canUndo(): Promise<boolean> {
    const current = await contentHash(this.serialized.targetPath);
    return current === this.serialized.desiredHash || current === this.serialized.expectedHash;
  }

  async undo(): Promise<void> {
    const current = await contentHash(this.serialized.targetPath);
    if (current === this.serialized.expectedHash) return;
    if (current !== this.serialized.desiredHash) throw new SagaDisputeError(await this.dispute());
    if (this.serialized.expectedHash === undefined) {
      await fs.rm(this.serialized.targetPath, { force: true });
      return;
    }
    const restorePath = `${this.serialized.stagePath}.undo`;
    await fs.copyFile(this.serialized.backupPath, restorePath);
    await fs.rename(restorePath, this.serialized.targetPath);
  }

  async dispute(): Promise<string> {
    const current = await contentHash(this.serialized.targetPath);
    return `expected ${this.serialized.expectedHash ?? "missing"} or ${this.serialized.desiredHash}, found ${current ?? "missing"}`;
  }

  async cleanup(): Promise<void> {
    await Promise.all([
      fs.rm(this.serialized.stagePath, { force: true }),
      fs.rm(`${this.serialized.stagePath}.undo`, { force: true }),
      fs.rm(this.serialized.backupPath, { force: true }),
    ]);
  }
}

export async function createFileCommand(options: {
  rootDir: string;
  sagaId: string;
  filePath: string;
  content: string;
}): Promise<Command> {
  const sagaDir = sagaDirectory(options.rootDir, options.sagaId);
  const targetPath = assertPathWithin(options.rootDir, options.filePath, "target");
  await assertPathHasNoSymlinkEscape(options.rootDir, targetPath, "target");
  await assertPathHasNoSymlinkEscape(options.rootDir, sagaDir, "stage");
  await fs.mkdir(sagaDir, { recursive: true });
  const token = hash(targetPath).slice(0, 16);
  const stagePath = path.join(sagaDir, `${token}.next`);
  const backupPath = path.join(sagaDir, `${token}.before`);
  await assertCommandPaths(options.rootDir, options.sagaId, { kind: "file", targetPath, stagePath, backupPath, desiredHash: hash(options.content) });
  const previous = await contentHash(targetPath);
  if (previous !== undefined) await fs.copyFile(targetPath, backupPath);
  await fs.writeFile(stagePath, options.content, "utf8");
  return new FileCommand({ kind: "file", targetPath, stagePath, backupPath, ...(previous === undefined ? {} : { expectedHash: previous }), desiredHash: hash(options.content) });
}

async function rehydrate(rootDir: string, sagaId: string, command: SerializedFileCommand): Promise<Command> {
  await assertCommandPaths(rootDir, sagaId, command);
  return new FileCommand(command);
}

export class Saga {
  readonly id: string;
  readonly authority: SagaAuthority;
  readonly commands: readonly Command[];

  constructor(options: { id?: string; authority: SagaAuthority; commands: readonly Command[] }) {
    this.id = options.id ?? randomUUID();
    assertSagaId(this.id);
    this.authority = options.authority;
    this.commands = options.commands;
  }
}

export class SagaExecutionHistory {
  constructor(private readonly store: SagaStore) {}

  append(fact: SagaExecutionFact): void {
    this.store.database.prepare(`INSERT INTO saga_execution_history (saga_id, revision, phase, command_index, fact, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(fact.sagaId, fact.revision, fact.phase, fact.commandIndex, fact.fact, fact.detail ?? null, new Date().toISOString());
  }

  list(sagaId: string): SagaExecutionFact[] {
    return (this.store.database.prepare(`SELECT saga_id, revision, phase, command_index, fact, detail FROM saga_execution_history WHERE saga_id = ? ORDER BY id`).all(sagaId) as Record<string, unknown>[])
      .map((row) => ({ sagaId: row.saga_id as string, revision: Number(row.revision), phase: row.phase as SagaPhase, commandIndex: Number(row.command_index), fact: row.fact as string, ...(typeof row.detail === "string" ? { detail: row.detail } : {}) }));
  }
}

/** SQLite-backed durable state for this Work check/evidence saga only. */
export class SagaStore {
  readonly rootDir: string;
  readonly runtime: RuntimeSqliteStore;
  readonly database;
  readonly history: SagaExecutionHistory;

  constructor(options: { rootDir: string }) {
    this.rootDir = path.resolve(options.rootDir);
    this.runtime = openRuntimeSqliteStore({ rootDir: this.rootDir });
    this.database = this.runtime.database;
    this.history = new SagaExecutionHistory(this);
  }

  close(): void { this.runtime.close(); }

  get(id: string): SagaInstance | undefined {
    const row = this.database.prepare("SELECT * FROM saga_instances WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.row(row) : undefined;
  }

  create(saga: Saga): SagaInstance {
    const existing = this.get(saga.id);
    if (existing) return existing;
    const instance: SagaInstance = { id: saga.id, status: "running", phase: "created", commandIndex: 0, revision: 1, commands: saga.commands.map((command) => command.serialized), authority: saga.authority };
    this.database.prepare(`INSERT INTO saga_instances (id, status, phase, command_index, revision, commands, authority, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(instance.id, instance.status, instance.phase, instance.commandIndex, instance.revision, JSON.stringify(instance.commands), JSON.stringify(instance.authority), new Date().toISOString());
    this.history.append({ sagaId: instance.id, revision: instance.revision, phase: instance.phase, commandIndex: instance.commandIndex, fact: "created" });
    return instance;
  }

  update(instance: SagaInstance, patch: Pick<SagaInstance, "status" | "phase" | "commandIndex">, fact: string, detail?: string): SagaInstance {
    const next: SagaInstance = { ...instance, ...patch, revision: instance.revision + 1 };
    const result = this.database.prepare(`UPDATE saga_instances SET status = ?, phase = ?, command_index = ?, revision = ?, updated_at = ?
      WHERE id = ? AND revision = ?`).run(next.status, next.phase, next.commandIndex, next.revision, new Date().toISOString(), next.id, instance.revision);
    if (Number(result.changes) !== 1) throw new Error(`Saga '${instance.id}' revision changed concurrently.`);
    this.history.append({ sagaId: next.id, revision: next.revision, phase: next.phase, commandIndex: next.commandIndex, fact, ...(detail ? { detail } : {}) });
    return next;
  }

  pending(): SagaInstance[] {
    return (this.database.prepare("SELECT * FROM saga_instances WHERE status IN ('running', 'compensating', 'completed', 'failed') ORDER BY updated_at").all() as Record<string, unknown>[]).map((row) => this.row(row));
  }

  private row(row: Record<string, unknown>): SagaInstance {
    let parsedAuthority: Record<string, unknown> | undefined;
    try {
      parsedAuthority = typeof row.authority === "string" ? JSON.parse(row.authority) as Record<string, unknown> : undefined;
    } catch {
      parsedAuthority = undefined;
    }
    const authority = parsedAuthority && typeof parsedAuthority.taskId === "string" && parsedAuthority.taskId.length > 0
      && (parsedAuthority.claimToken === undefined || typeof parsedAuthority.claimToken === "string")
      ? { taskId: parsedAuthority.taskId, ...(typeof parsedAuthority.claimToken === "string" ? { claimToken: parsedAuthority.claimToken } : {}) }
      : undefined;
    return { id: row.id as string, status: row.status as SagaStatus, phase: row.phase as SagaPhase, commandIndex: Number(row.command_index), revision: Number(row.revision), commands: JSON.parse(row.commands as string) as SerializedFileCommand[], ...(authority ? { authority } : {}) };
  }
}

export interface SagaHooks {
  /** Revalidate the persisted Work Item claim before participant effects resume. */
  authorize?(authority: SagaAuthority, instance: SagaInstance): void | Promise<void>;
  afterBoundary?(phase: SagaPhase, instance: SagaInstance): void | Promise<void>;
}

/** Executes the fixed evidence-record then Work-check command series. */
export class SagaOrchestrator {
  constructor(private readonly store: SagaStore, private readonly hooks: SagaHooks = {}) {}

  async recoverPending(): Promise<SagaInstance[]> {
    return Promise.all(this.store.pending().map((instance) => this.run(instance)));
  }

  async execute(saga: Saga): Promise<SagaInstance> {
    const instance = this.store.create(saga);
    if (instance.phase === "created") await this.boundary(instance);
    return this.run(instance);
  }

  async recover(sagaId: string): Promise<SagaInstance | undefined> {
    const instance = this.store.get(sagaId);
    return instance ? this.run(instance) : undefined;
  }

  private async boundary(instance: SagaInstance): Promise<void> {
    await this.hooks.afterBoundary?.(instance.phase, instance);
  }

  private async run(initial: SagaInstance): Promise<SagaInstance> {
    let instance = initial;
    let commands: Command[];
    try {
      commands = await Promise.all(instance.commands.map((command) => rehydrate(this.store.rootDir, instance.id, command)));
    } catch (error) {
      return this.dispute(instance, "path-disputed", error);
    }
    if (instance.status === "completed" || instance.status === "failed") {
      await this.cleanup(commands);
      return instance;
    }
    if (instance.status === "disputed") return instance;
    if (!instance.authority || !this.hooks.authorize) {
      return this.dispute(instance, "authorization-disputed", new Error("Saga authority cannot be revalidated."));
    }
    try {
      await this.hooks.authorize(instance.authority, instance);
    } catch (error) {
      return this.dispute(instance, "authorization-disputed", error);
    }
    try {
      if (instance.status === "compensating") return this.compensate(instance, commands);
      while (instance.commandIndex < commands.length) {
        const command = commands[instance.commandIndex]!;
        if (!(await command.canExecute())) throw new SagaDisputeError(await command.dispute());
        instance = this.store.update(instance, { status: "running", phase: "intent", commandIndex: instance.commandIndex }, "intent");
        await this.boundary(instance);
        await command.execute();
        instance = this.store.update(instance, { status: "running", phase: "effect", commandIndex: instance.commandIndex }, "effect-recorded");
        await this.boundary(instance);
        instance = this.store.update(instance, { status: "running", phase: "applied", commandIndex: instance.commandIndex + 1 }, "applied");
        await this.boundary(instance);
      }
      instance = this.store.update(instance, { status: "completed", phase: "completed", commandIndex: commands.length }, "completed");
      await this.boundary(instance);
      await this.cleanup(commands);
      return instance;
    } catch (error) {
      if (error instanceof SagaInterruption) throw error;
      if (error instanceof SagaDisputeError) {
        return this.store.update(instance, { status: "disputed", phase: "disputed", commandIndex: instance.commandIndex }, "disputed", error.message);
      }
      instance = this.store.update(instance, { status: "compensating", phase: "undo-intent", commandIndex: instance.commandIndex }, "compensation-started", error instanceof Error ? error.message : String(error));
      return this.compensate(instance, commands);
    }
  }

  private dispute(instance: SagaInstance, fact: string, error: unknown): SagaInstance {
    const detail = error instanceof Error ? error.message : String(error);
    return this.store.update(instance, { status: "disputed", phase: "disputed", commandIndex: instance.commandIndex }, fact, detail);
  }

  private async compensate(initial: SagaInstance, commands: readonly Command[]): Promise<SagaInstance> {
    let instance = initial;
    try {
      for (let index = instance.commandIndex - 1; index >= 0; index -= 1) {
        const command = commands[index]!;
        if (!(await command.canUndo())) throw new SagaDisputeError(await command.dispute());
        instance = this.store.update(instance, { status: "compensating", phase: "undo-intent", commandIndex: index + 1 }, "undo-intent");
        await this.boundary(instance);
        await command.undo();
        instance = this.store.update(instance, { status: "compensating", phase: "undone", commandIndex: index }, "undone");
        await this.boundary(instance);
      }
      instance = this.store.update(instance, { status: "failed", phase: "failed", commandIndex: 0 }, "compensated");
      await this.boundary(instance);
      await this.cleanup(commands);
      return instance;
    } catch (error) {
      if (error instanceof SagaInterruption) throw error;
      if (error instanceof SagaDisputeError) return this.store.update(instance, { status: "disputed", phase: "disputed", commandIndex: instance.commandIndex }, "disputed", error.message);
      throw error;
    }
  }

  private async cleanup(commands: readonly Command[]): Promise<void> {
    await Promise.all(commands.map((command) => command.cleanup()));
  }
}
