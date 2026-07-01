export function stripInlineCode(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function stripWikiLink(value: string): string {
  const withoutBrackets = value
    .trim()
    .replace(/^\[\[/u, "")
    .replace(/\]\]$/u, "");
  const target = withoutBrackets.split("|", 1)[0] ?? "";
  return stripInlineCode(target).split("#", 1)[0]?.trim() ?? "";
}
