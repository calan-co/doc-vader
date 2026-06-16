type JsonObject = Record<string, unknown>;

interface RenderContext {
  scopes: JsonObject[];
}

const templateTokenPattern = /({{[\s\S]*?}}|{%[\s\S]*?%}|{#[\s\S]*?#})/g;

function stripTemplateFrontmatter(template: string): string {
  return template.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function tokenizeTemplate(template: string): string[] {
  return template
    .split(templateTokenPattern)
    .filter((token) => token.length > 0);
}

function normalizeTemplateExpression(expression: string): string {
  return expression.trim().replace(/^-/, "").replace(/-$/, "").trim();
}

function tagContent(token: string): string | null {
  if (!token.startsWith("{%")) {
    return null;
  }
  return normalizeTemplateExpression(token.slice(2, -2));
}

function isTag(token: string, tagName: string): boolean {
  return tagContent(token) === tagName;
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

function evaluateIfExpression(
  context: RenderContext,
  expression: string,
): boolean {
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
        return { inner: tokens.slice(startIndex, i), nextIndex: i + 1 };
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
          falsy: elseIndex === undefined ? [] : tokens.slice(elseIndex + 1, i),
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
      output += formatValue(
        lookup(context, normalizeTemplateExpression(token.slice(2, -2))),
      );
      i += 1;
      continue;
    }
    const content = tagContent(token);
    if (content?.startsWith("for ")) {
      const match = content.match(
        /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/,
      );
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

export function renderTempljsTemplate(
  template: string,
  payload: JsonObject,
): string {
  const body = stripTemplateFrontmatter(template);
  const markdown = renderTokens(tokenizeTemplate(body), {
    scopes: [payload],
  }).trim();
  return `${collapseBlankLinesOutsideFences(markdown)}\n`;
}
