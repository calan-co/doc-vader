import { createHash } from "node:crypto";
import { TaskCommandError } from "../task/errors.js";
import { resolveWorkManagementChecklistDefinitions } from "./checklist-definitions.js";

/** A scope addressed by a qualifier. */
export type ScopeId = string;
/** A revision-scoped source address for a Markdown qualifier. */
export type QualifierId = string;
export type QualifierStatus =
  | "met"
  | "unmet"
  | "not-applicable"
  | "indeterminate";

export interface Qualifier {
  readonly id: QualifierId;
  readonly scopes: readonly ScopeId[];
  readonly status: QualifierStatus;
  readonly evidence?: readonly string[];
}

export interface CompositeQualifier<Child extends Qualifier = Qualifier>
  extends Qualifier {
  readonly scope: ScopeId;
  readonly required: boolean;
  readonly policy: QualifierStatusPolicy;
  readonly children: readonly Child[];
}

export interface QualifierLeaf extends Qualifier {
  readonly scope: ScopeId;
  readonly label: string;
}

export interface QualifierStatusPolicy {
  readonly id: string;
  evaluate(
    qualifiers: readonly Qualifier[],
    options?: { readonly required?: boolean },
  ): QualifierStatus;
}

export interface WorkItemCompletionQualifier
  extends CompositeQualifier<CompositeQualifier<QualifierLeaf>> {
  readonly scope: "completion";
  readonly revision: string;
  readonly children: readonly CompositeQualifier<QualifierLeaf>[];
}

export interface WorkItemQualifierProjection {
  readonly revision: string;
  readonly qualifier: WorkItemCompletionQualifier;
}

/** A fidelity-preserving Markdown leaf mutation result. */
export interface MarkdownQualifierLeafMutation extends WorkItemQualifierProjection {
  readonly markdown: string;
}

/** Rejects an unsupported or no-longer-current Markdown qualifier write. */
export class MarkdownQualifierMutationError extends TaskCommandError {
  constructor(
    code:
      | "MARKDOWN_QUALIFIER_STALE_ID"
      | "MARKDOWN_QUALIFIER_DERIVED_ID"
      | "MARKDOWN_QUALIFIER_UNKNOWN_ID"
      | "MARKDOWN_QUALIFIER_UNREPRESENTABLE_STATUS",
    message: string,
    details: Record<string, unknown>,
  ) {
    super(code, message, details);
    this.name = "MarkdownQualifierMutationError";
  }
}

export interface CompletionQualifierBlocker {
  readonly scope: ScopeId;
  readonly status: QualifierStatus;
  readonly id?: QualifierId;
  readonly label?: string;
}

/** A fail-closed terminal-completion error with inspectable qualifier state. */
export class WorkItemCompletionQualifierError extends Error {
  readonly code = "WORK_ITEM_COMPLETION_QUALIFIERS_BLOCKED";

  constructor(
    message: string,
    readonly details: {
      readonly status: QualifierStatus;
      readonly blockers: readonly CompletionQualifierBlocker[];
    },
  ) {
    super(message);
    this.name = "WorkItemCompletionQualifierError";
  }
}


/**
 * Aggregate a scope only when every applicable child is met. Required empty
 * composites are deliberately indeterminate so callers fail closed.
 */
export const allApplicableMet: QualifierStatusPolicy = {
  id: "all-applicable-met",
  evaluate(qualifiers, options = {}) {
    if (qualifiers.some((qualifier) => qualifier.status === "unmet")) {
      return "unmet";
    }
    if (qualifiers.some((qualifier) => qualifier.status === "indeterminate")) {
      return "indeterminate";
    }
    const applicable = qualifiers.filter(
      (qualifier) => qualifier.status !== "not-applicable",
    );
    if (applicable.length === 0) {
      return qualifiers.length === 0 && options.required
        ? "indeterminate"
        : "not-applicable";
    }
    return "met";
  },
};

function revisionFor(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function sectionSource(
  markdown: string,
  heading: string,
): { body: string; start: number } | undefined {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\n)##\\s+${escapedHeading}(?:\\b[^\\n]*)?\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  ).exec(markdown);
  const body = match?.[1];
  return body === undefined || match === null
    ? undefined
    : { body, start: match.index + match[0].length - body.length };
}

function sectionBody(markdown: string, heading: string): string | undefined {
  return sectionSource(markdown, heading)?.body;
}

/** A pack-owned Markdown section that projects to one Work Item checklist. */
export interface MarkdownChecklistDefinition {
  readonly id: string;
  readonly heading: string;
}

/** One pack-projected source checkbox with a Markdown-native current address. */
export interface MarkdownChecklistCheck {
  readonly id: string;
  readonly label: string;
  readonly status: Extract<QualifierStatus, "met" | "unmet">;
}

export interface MarkdownChecklist {
  readonly id: string;
  readonly checks: readonly MarkdownChecklistCheck[];
}

export interface MarkdownChecklistProjection {
  readonly checklists: readonly MarkdownChecklist[];
}

function naturalCheckId(path: readonly number[], label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "check";
  return `${path.join(".")}-${slug}`;
}

/**
 * Projects pack-declared Markdown checklist sections. Check IDs are current,
 * Markdown-native addresses; their representation is supplied by this adapter,
 * not a CLI contract.
 */
export function projectMarkdownChecklists(
  markdown: string,
  definitions: readonly MarkdownChecklistDefinition[],
): MarkdownChecklistProjection {
  return {
    checklists: definitions.map((definition) => {
      const body = sectionBody(markdown, definition.heading);
      const checks: MarkdownChecklistCheck[] = [];
      if (body !== undefined) {
        const parents: Array<{ indent: number; path: number[] }> = [];
        const ordinals = new Map<string, number>();
        for (const line of body.split("\n")) {
          const listItem = line.match(/^(\s*)[-*+]\s+(.*)$/);
          if (!listItem) continue;
          const indent = listItem[1]?.replace(/\t/g, "  ").length ?? 0;
          while (parents.length > 0 && parents.at(-1)!.indent >= indent) parents.pop();
          const parentPath = parents.at(-1)?.path ?? [];
          const parentKey = parentPath.join(".");
          const ordinal = (ordinals.get(parentKey) ?? 0) + 1;
          ordinals.set(parentKey, ordinal);
          const ordinalPath = [...parentPath, ordinal];
          parents.push({ indent, path: ordinalPath });
          const checkbox = listItem[2]?.match(/^\[([ xX])\]\s+(.+)$/);
          const label = checkbox?.[2]?.trim();
          if (!checkbox || !label) continue;
          checks.push({
            id: naturalCheckId(ordinalPath, label),
            label,
            status: checkbox[1]?.toLowerCase() === "x" ? "met" : "unmet",
          });
        }
      }
      return { id: definition.id, checks };
    }),
  };
}

function projectSection(
  markdown: string,
  revision: string,
  scope: string,
  heading: string,
): CompositeQualifier<QualifierLeaf> {
  const body = sectionBody(markdown, heading);
  const leaves: QualifierLeaf[] = [];
  if (body !== undefined) {
    const parents: Array<{ indent: number; path: number[] }> = [];
    const ordinals = new Map<string, number>();
    for (const line of body.split("\n")) {
      const listItem = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (!listItem) {
        continue;
      }
      const indent = listItem[1]?.replace(/\t/g, "  ").length ?? 0;
      while (parents.length > 0 && parents.at(-1)!.indent >= indent) {
        parents.pop();
      }
      const parentPath = parents.at(-1)?.path ?? [];
      const parentKey = parentPath.join(".");
      const ordinal = (ordinals.get(parentKey) ?? 0) + 1;
      ordinals.set(parentKey, ordinal);
      const ordinalPath = [...parentPath, ordinal];
      parents.push({ indent, path: ordinalPath });

      const checkbox = listItem[2]?.match(/^\[([ xX])\]\s+(.+)$/);
      if (!checkbox) {
        continue;
      }
      const label = checkbox[2]?.trim();
      if (!label) {
        continue;
      }
      leaves.push({
        id: `${revision}::${scope}.${ordinalPath.join(".")}`,
        scopes: [scope],
        scope,
        label,
        status: checkbox[1]?.toLowerCase() === "x" ? "met" : "unmet",
      });
    }
  }

  return {
    id: `${revision}::${scope}`,
    scopes: [scope],
    scope,
    required: true,
    policy: allApplicableMet,
    children: leaves,
    status: allApplicableMet.evaluate(leaves, { required: true }),
  };
}

/** Project Markdown Tasks and Acceptance Criteria into completion qualifiers. */
export function evaluateWorkItemCompletion(
  markdown: string,
  definitions = resolveWorkManagementChecklistDefinitions(),
): WorkItemCompletionQualifier {
  const revision = revisionFor(markdown);
  const children = definitions.map((definition) =>
    projectSection(markdown, revision, definition.id, definition.heading),
  );
  return {
    id: `${revision}::completion`,
    scopes: ["completion"],
    scope: "completion",
    revision,
    required: true,
    policy: allApplicableMet,
    children,
    status: allApplicableMet.evaluate(children, { required: true }),
  };
}

export function projectWorkItemQualifiers(
  markdown: string,
  definitions?: readonly MarkdownChecklistDefinition[],
): WorkItemQualifierProjection {
  const qualifier = evaluateWorkItemCompletion(markdown, definitions);
  return { revision: qualifier.revision, qualifier };
}

function findMarkdownCheckboxOffset(
  markdown: string,
  revision: string,
  targetId: string,
  definitions = resolveWorkManagementChecklistDefinitions(),
): number | undefined {
  for (const { id: scope, heading } of definitions) {
    const source = sectionSource(markdown, heading);
    if (!source) {
      continue;
    }
    const { body, start: bodyStart } = source;
    const parents: Array<{ indent: number; path: number[] }> = [];
    const ordinals = new Map<string, number>();
    let lineStart = bodyStart;
    for (const line of body.split(/(?<=\n)/)) {
      const content = line.endsWith("\n") ? line.slice(0, -1) : line;
      const listItem = content.match(/^(\s*)[-*+]\s+(.*)$/);
      if (listItem) {
        const indent = listItem[1]?.replace(/\t/g, "  ").length ?? 0;
        while (parents.length > 0 && parents.at(-1)!.indent >= indent) {
          parents.pop();
        }
        const parentPath = parents.at(-1)?.path ?? [];
        const parentKey = parentPath.join(".");
        const ordinal = (ordinals.get(parentKey) ?? 0) + 1;
        ordinals.set(parentKey, ordinal);
        const ordinalPath = [...parentPath, ordinal];
        parents.push({ indent, path: ordinalPath });
        const checkbox = listItem[2]?.match(/^\[([ xX])\]\s+(.+)$/);
        if (
          checkbox &&
          targetId === `${revision}::${scope}.${ordinalPath.join(".")}`
        ) {
          return lineStart + content.indexOf(checkbox[0]) + 1;
        }
      }
      lineStart += line.length;
    }
  }
  return undefined;
}

/**
 * Applies one met/unmet leaf operation without serializing or normalizing the
 * surrounding Markdown. IDs must be from the current source revision.
 */
export function mutateMarkdownQualifierLeaf(options: {
  markdown: string;
  id: QualifierId;
  status: QualifierStatus;
  definitions?: readonly MarkdownChecklistDefinition[];
}): MarkdownQualifierLeafMutation {
  if (options.status !== "met" && options.status !== "unmet") {
    throw new MarkdownQualifierMutationError(
      "MARKDOWN_QUALIFIER_UNREPRESENTABLE_STATUS",
      `Markdown checkboxes cannot faithfully represent '${options.status}'.`,
      { id: options.id, status: options.status },
    );
  }

  const projection = projectWorkItemQualifiers(options.markdown, options.definitions);
  const separator = options.id.indexOf("::");
  const idRevision = separator < 0 ? undefined : options.id.slice(0, separator);
  if (idRevision !== projection.revision) {
    throw new MarkdownQualifierMutationError(
      "MARKDOWN_QUALIFIER_STALE_ID",
      "Markdown qualifier IDs are valid only for the source revision that produced them.",
      { id: options.id, expectedRevision: projection.revision, actualRevision: idRevision },
    );
  }

  const leaf = projection.qualifier.children
    .flatMap((scope) => scope.children)
    .find((candidate) => candidate.id === options.id);
  if (!leaf) {
    const currentQualifierIds = [
      projection.qualifier.id,
      ...projection.qualifier.children.map((scope) => scope.id),
    ];
    if (currentQualifierIds.includes(options.id)) {
      throw new MarkdownQualifierMutationError(
        "MARKDOWN_QUALIFIER_DERIVED_ID",
        "Only source Markdown leaf qualifiers can be changed.",
        { id: options.id },
      );
    }
    throw new MarkdownQualifierMutationError(
      "MARKDOWN_QUALIFIER_UNKNOWN_ID",
      "Markdown qualifier ID does not address a current source leaf.",
      { id: options.id },
    );
  }

  if (leaf.status === options.status) {
    return { markdown: options.markdown, ...projection };
  }

  const offset = findMarkdownCheckboxOffset(
    options.markdown,
    projection.revision,
    options.id,
    options.definitions,
  );
  if (offset === undefined) {
    throw new MarkdownQualifierMutationError(
      "MARKDOWN_QUALIFIER_UNKNOWN_ID",
      "Markdown qualifier ID does not address a writable source checkbox.",
      { id: options.id },
    );
  }
  const marker = options.status === "met" ? "x" : " ";
  const markdown = `${options.markdown.slice(0, offset)}${marker}${options.markdown.slice(offset + 1)}`;
  const updated = projectWorkItemQualifiers(markdown, options.definitions);
  return { markdown, ...updated };
}

export function isRevisionScopedQualifierId(value: string): boolean {
  return /^[a-f0-9]+::[a-z][a-z-]*(?:\.\d+)+$/i.test(value);
}
