// src/parsers/wikilink.ts
function parseWikilink(_text) {
  const regex = /\\?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const results = [];
  let match;
  while ((match = regex.exec(_text)) !== null) {
    const full = match[0];
    const value = match[1];
    const alias = match[2];
    if (typeof value === "string") {
      results.push({
        type: "wikilink",
        value,
        ...alias ? { alias } : {},
        position: {
          start: match.index,
          end: alias ? match.index + full.length - 1 : match.index + full.length
        }
      });
    }
  }
  return results;
}

// src/parsers/markdown.ts
function parseMarkdownLink(_text) {
  const text = _text;
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [full, value, url] = match;
    if (typeof value === "string" && typeof url === "string") {
      results.push({
        type: "markdown",
        value,
        url,
        position: {
          start: match.index,
          end: match.index + full.length - 1
        }
      });
    }
  }
  return results;
}

// src/parsers/url.ts
function parseRawUrl(_text) {
  const text = _text;
  const defaultSchemes = ["http", "https"];
  const customSchemes = arguments.length > 1 ? arguments[1] : [];
  const allSchemes = [
    ...defaultSchemes,
    ...Array.isArray(customSchemes) ? customSchemes : []
  ];
  const schemePattern = allSchemes.map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  const regex = new RegExp(
    `\\b(?:${schemePattern}):\\/\\/[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+`,
    "g"
  );
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [full] = match;
    const scheme = full.split(":")[0];
    if (typeof scheme === "string") {
      const cleanUrl = full.replace(/[.,!?;:]+$/, "");
      results.push({
        type: allSchemes.includes(scheme) ? defaultSchemes.includes(scheme) ? "url" : "custom" : "url",
        value: cleanUrl,
        url: cleanUrl,
        position: {
          start: match.index,
          end: match.index + cleanUrl.length
        }
      });
    }
  }
  return results;
}

// src/utils/detect.ts
function detectLinkType(_str) {
  const str = _str;
  if (/^\[\[[^\]|]+(\|[^\]]+)?\]\]$/.test(str)) return "wikilink";
  if (/^\[[^\]]+\]\([^\)]+\)$/.test(str)) return "markdown";
  if (/^https?:\/\/.+/.test(str)) return "url";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/.+/.test(str)) return "custom";
  return null;
}

// src/index.ts
function getNonCodeRanges(text) {
  const ranges = [];
  const fenceRe = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const fenceStart = m.index;
    const fenceEnd = m.index + m[0].length;
    if (lastIndex < fenceStart) {
      ranges.push({ start: lastIndex, end: fenceStart });
    }
    lastIndex = fenceEnd;
  }
  if (lastIndex < text.length) {
    ranges.push({ start: lastIndex, end: text.length });
  }
  if (ranges.length === 0 && text.length > 0) {
    ranges.push({ start: 0, end: text.length });
  }
  return ranges;
}
function parseLinks(text, options) {
  const {
    enableWikilink = true,
    enableMarkdown = true,
    enableUrl = true
  } = options || {};
  const results = [];
  const ranges = getNonCodeRanges(text);
  for (const { start, end } of ranges) {
    if (start >= end) continue;
    const slice = text.slice(start, end);
    if (enableWikilink) {
      const nodes = parseWikilink(slice).map(
        (n) => n.position ? {
          ...n,
          position: {
            start: n.position.start + start,
            end: n.position.end + start
          }
        } : n
      );
      results.push(...nodes);
    }
    if (enableMarkdown) {
      const nodes = parseMarkdownLink(slice).map(
        (n) => n.position ? {
          ...n,
          position: {
            start: n.position.start + start,
            end: n.position.end + start
          }
        } : n
      );
      results.push(...nodes);
    }
    if (enableUrl) {
      const nodes = parseRawUrl(slice).map(
        (n) => n.position ? {
          ...n,
          position: {
            start: n.position.start + start,
            end: n.position.end + start
          }
        } : n
      );
      results.push(...nodes);
    }
  }
  return results;
}

export { detectLinkType, parseLinks, parseMarkdownLink, parseRawUrl, parseWikilink };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map