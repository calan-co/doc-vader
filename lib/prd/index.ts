import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import { promises as fs } from "node:fs";
import * as path from "node:path";

type JsonObject = Record<string, unknown>;

export interface ValidatePrdPayloadOptions {
  rootDir?: string;
  payloadPath: string;
}

export interface ValidatePrdPayloadResult {
  payloadPath: string;
  valid: boolean;
  errors: unknown[];
}

export interface RenderPrdOptions {
  rootDir?: string;
  payloadPath: string;
  templatePath?: string;
  outputPath?: string;
  jsonOutputPath?: string;
  id: string;
  title: string;
  summary: string;
  lifecycle?: string;
  status?: string;
  statusReason?: string;
  owner?: string;
  assignee?: string;
  tags?: string[];
}

export interface RenderPrdResult {
  payloadPath: string;
  templatePath: string;
  outputPath?: string;
  jsonOutputPath?: string;
  frontmatter: JsonObject;
  markdown?: string;
  validation: ValidatePrdPayloadResult;
}

interface RenderContext {
  scopes: JsonObject[];
}

const CONTENT_SCHEMA_PATH = "schemas/work-management/content/prd.json";
const FRONTMATTER_SCHEMA_PATH = "schemas/work-management/frontmatter/prd.json";
const DEFAULT_TEMPLATE_PATH = "templates/reference/work-management/prd.md.tpl";

const templateTokenPattern = /({{[\s\S]*?}}|{%[\s\S]*?%}|{#[\s\S]*?#})/g;

function resolveRoot(rootDir?: string): string {
  return path.resolve(rootDir ?? process.cwd());
}

function resolveFromRoot(rootDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(rootDir, targetPath);
}

async function readJson(filePath: string): Promise<JsonObject> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as JsonObject;
}

async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkJsonFiles(entryPath);
      }
      return entry.name.endsWith(".json") ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function addSchemaIfMissing(ajv: Ajv2020, schema: JsonObject): void {
  try {
    ajv.addSchema(schema);
  } catch {
    // Aliases intentionally overlap across current/versioned schemas.
  }
}

function addSchemaAlias(ajv: Ajv2020, schema: JsonObject, id: string): void {
  addSchemaIfMissing(ajv, { ...schema, $id: id });
  if (id.endsWith(".json")) {
    addSchemaIfMissing(ajv, { ...schema, $id: id.slice(0, -5) });
  }
}

async function createContentAjv(rootDir: string): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const common = await readJson(
    path.join(rootDir, "schemas/work-management/support/common.json"),
  );
  addSchemaIfMissing(ajv, common);
  addSchemaAlias(ajv, common, "/work-management/support/common.json");
  return ajv;
}

async function createFrontmatterAjv(rootDir: string): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const supportDir = path.join(rootDir, "schemas/frontmatter/support");
  for (const schemaPath of await walkJsonFiles(supportDir)) {
    const schema = await readJson(schemaPath);
    addSchemaIfMissing(ajv, schema);
    const rel = path.relative(rootDir, schemaPath).split(path.sep).join("/");
    addSchemaAlias(
      ajv,
      schema,
      `https://raw.githubusercontent.com/templjs/templ.js/main/${rel}`,
    );
    addSchemaAlias(
      ajv,
      schema,
      `https://raw.githubusercontent.com/calan-co/doc-vader/main/${rel}`,
    );
  }

  const common = await readJson(
    path.join(rootDir, "schemas/work-management/support/common.json"),
  );
  addSchemaIfMissing(ajv, common);
  addSchemaAlias(ajv, common, "/work-management/support/common.json");
  return ajv;
}

export async function validatePrdPayload(
  options: ValidatePrdPayloadOptions,
): Promise<ValidatePrdPayloadResult> {
  const rootDir = resolveRoot(options.rootDir);
  const payloadPath = resolveFromRoot(rootDir, options.payloadPath);
  const schemaPath = path.join(rootDir, CONTENT_SCHEMA_PATH);
  const [schema, payload] = await Promise.all([
    readJson(schemaPath),
    readJson(payloadPath),
  ]);
  const ajv = await createContentAjv(rootDir);
  const validate = ajv.compile(schema);
  const valid = Boolean(validate(payload));
  return {
    payloadPath,
    valid,
    errors: validate.errors ?? [],
  };
}

async function validatePrdFrontmatter(
  rootDir: string,
  frontmatter: JsonObject,
): Promise<void> {
  const schema = await readJson(path.join(rootDir, FRONTMATTER_SCHEMA_PATH));
  const ajv = await createFrontmatterAjv(rootDir);
  const validate = ajv.compile(schema);
  if (!validate(frontmatter)) {
    throw new Error(
      `PRD frontmatter failed validation: ${JSON.stringify(
        validate.errors ?? [],
        null,
        2,
      )}`,
    );
  }
}

function stripTemplateFrontmatter(template: string): string {
  return template.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function tokenizeTemplate(template: string): string[] {
  return template
    .split(templateTokenPattern)
    .filter((token) => token.length > 0);
}

function isTag(token: string, tagName: string): boolean {
  return tagContent(token) === tagName;
}

function tagContent(token: string): string | null {
  if (!token.startsWith("{%")) {
    return null;
  }
  return normalizeTemplateExpression(token.slice(2, -2));
}

function normalizeTemplateExpression(expression: string): string {
  return expression.trim().replace(/^-/, "").replace(/-$/, "").trim();
}

function lookup(context: RenderContext, expression: string): unknown {
  const parts = expression.trim().split(".");
  for (const scope of context.scopes) {
    let value: unknown = scope;
    for (const part of parts) {
      if (
        value &&
        typeof value === "object" &&
        Object.prototype.hasOwnProperty.call(value, part)
      ) {
        value = (value as JsonObject)[part];
      } else {
        value = undefined;
        break;
      }
    }
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value);
}

function evaluateIfExpression(context: RenderContext, expression: string): boolean {
  const typeCheck = expression.match(/^(.+?)\s*\|\s*type\s*==\s*"([^"]+)"$/);
  if (typeCheck) {
    const value = lookup(context, typeCheck[1] ?? "");
    const expected = typeCheck[2];
    const actual = Array.isArray(value) ? "array" : typeof value;
    return actual === expected;
  }
  return isTruthy(lookup(context, expression));
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function extractBlock(
  tokens: string[],
  startIndex: number,
  openPrefix: string,
  closeTag: string,
): { inner: string[]; nextIndex: number } {
  let depth = 0;
  for (let i = startIndex; i < tokens.length; i += 1) {
    const content = tagContent(tokens[i] ?? "");
    if (!content) {
      continue;
    }
    if (content.startsWith(openPrefix)) {
      depth += 1;
      continue;
    }
    if (content === closeTag) {
      if (depth === 0) {
        return {
          inner: tokens.slice(startIndex, i),
          nextIndex: i + 1,
        };
      }
      depth -= 1;
    }
  }
  throw new Error(`Missing template tag: ${closeTag}`);
}

function extractIfBlock(
  tokens: string[],
  startIndex: number,
): { truthy: string[]; falsy: string[]; nextIndex: number } {
  let depth = 0;
  let elseIndex: number | undefined;
  for (let i = startIndex; i < tokens.length; i += 1) {
    const content = tagContent(tokens[i] ?? "");
    if (!content) {
      continue;
    }
    if (content.startsWith("if ")) {
      depth += 1;
      continue;
    }
    if (content === "else" && depth === 0) {
      elseIndex = i;
      continue;
    }
    if (content === "endif") {
      if (depth === 0) {
        return {
          truthy: tokens.slice(startIndex, elseIndex ?? i),
          falsy:
            elseIndex === undefined ? [] : tokens.slice(elseIndex + 1, i),
          nextIndex: i + 1,
        };
      }
      depth -= 1;
    }
  }
  throw new Error("Missing template tag: endif");
}

function renderTokens(tokens: string[], context: RenderContext): string {
  let output = "";
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i] ?? "";
    if (token.startsWith("{#")) {
      i += 1;
      continue;
    }
    if (token.startsWith("{{")) {
      output += formatValue(lookup(context, normalizeTemplateExpression(token.slice(2, -2))));
      i += 1;
      continue;
    }
    const content = tagContent(token);
    if (content?.startsWith("for ")) {
      const match = content.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/);
      if (!match) {
        throw new Error(`Unsupported template for tag: ${content}`);
      }
      const [, itemName, listExpression] = match;
      const block = extractBlock(tokens, i + 1, "for ", "endfor");
      const list = lookup(context, listExpression ?? "");
      if (Array.isArray(list)) {
        output += list
          .map((item, index) =>
            renderTokens(block.inner, {
              scopes: [
                {
                  [itemName ?? "item"]: item,
                  loop: { index: index + 1 },
                },
                ...context.scopes,
              ],
            }),
          )
          .join("");
      }
      i = block.nextIndex;
      continue;
    }
    if (content?.startsWith("if ")) {
      const block = extractIfBlock(tokens, i + 1);
      output += renderTokens(
        evaluateIfExpression(context, content.slice(3))
          ? block.truthy
          : block.falsy,
        context,
      );
      i = block.nextIndex;
      continue;
    }
    if (
      content &&
      (isTag(token, "endif") || isTag(token, "endfor") || isTag(token, "else"))
    ) {
      throw new Error(`Unexpected template tag: ${content}`);
    }
    output += token;
    i += 1;
  }
  return output;
}

function collapseBlankLinesOutsideFences(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let inFence = false;
  let blankLineCount = 0;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      blankLineCount = 0;
      output.push(line);
      continue;
    }

    if (!inFence && line.trim() === "") {
      blankLineCount += 1;
      if (blankLineCount <= 1) {
        output.push(line);
      }
      continue;
    }

    blankLineCount = 0;
    output.push(line);
  }

  return output.join("\n");
}

function renderTemplate(template: string, payload: JsonObject): string {
  const body = stripTemplateFrontmatter(template);
  const markdown = renderTokens(tokenizeTemplate(body), { scopes: [payload] }).trim();
  return `${collapseBlankLinesOutsideFences(markdown)}\n`;
}

function buildFrontmatter(options: RenderPrdOptions): JsonObject {
  return {
    $schema: "schemas/work-management/frontmatter/prd.json",
    $content_schema: "schemas/work-management/content/prd.json",
    $template: options.templatePath ?? DEFAULT_TEMPLATE_PATH,
    id: options.id,
    title: options.title,
    summary: options.summary,
    owner: options.owner,
    assignee: options.assignee,
    type: "plan",
    subtype: "x-prd",
    lifecycle: options.lifecycle ?? "active",
    status: options.status ?? "ready",
    status_reason: options.statusReason,
    tags: options.tags && options.tags.length > 0 ? options.tags : undefined,
  };
}

function pruneUndefined(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function formatMarkdown(frontmatter: JsonObject, body: string): string {
  return `---\n${yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  })}---\n\n${body}`;
}

export async function renderPrd(
  options: RenderPrdOptions,
): Promise<RenderPrdResult> {
  const rootDir = resolveRoot(options.rootDir);
  const payloadPath = resolveFromRoot(rootDir, options.payloadPath);
  const templatePath = resolveFromRoot(
    rootDir,
    options.templatePath ?? DEFAULT_TEMPLATE_PATH,
  );
  const validation = await validatePrdPayload({
    rootDir,
    payloadPath,
  });
  if (!validation.valid) {
    throw new Error(
      `PRD content payload failed validation: ${JSON.stringify(
        validation.errors,
        null,
        2,
      )}`,
    );
  }

  const [payload, template] = await Promise.all([
    readJson(payloadPath),
    fs.readFile(templatePath, "utf8"),
  ]);
  const frontmatter = pruneUndefined(buildFrontmatter(options));
  await validatePrdFrontmatter(rootDir, frontmatter);

  const markdown = formatMarkdown(frontmatter, renderTemplate(template, payload));

  let outputPath: string | undefined;
  if (options.outputPath) {
    outputPath = resolveFromRoot(rootDir, options.outputPath);
    await writeTextFile(outputPath, markdown);
  }

  let jsonOutputPath: string | undefined;
  if (options.jsonOutputPath) {
    jsonOutputPath = resolveFromRoot(rootDir, options.jsonOutputPath);
    await writeTextFile(
      jsonOutputPath,
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  }

  return {
    payloadPath,
    templatePath,
    outputPath,
    jsonOutputPath,
    frontmatter,
    markdown: outputPath ? undefined : markdown,
    validation,
  };
}
