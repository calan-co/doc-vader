# Linkity

Unified link format AST library for Node.js and browsers (ESM-first).

## Features

- 🔗 **Wikilink Support**: Parse Obsidian-style `[[Page]]` and `[[Page|Alias]]` links
- 📝 **Markdown Links**: Parse GFM-style `[text](url)` links
- 🌐 **Raw URLs**: Detect and parse standalone URLs
- 🎯 **Type-Safe**: Full TypeScript support with type definitions
- 🌍 **Universal**: Works in Node.js and browsers
- 🎨 **ESM-First**: Modern ES modules with CJS fallback
- 🪶 **Lightweight**: Zero dependencies, tree-shakeable

## Installation

```bash
npm install linkity
```

## Quick Start

### Node.js (ESM)

```typescript
import { parseLinks } from "linkity";

const text = "Check [[Page]] and [link](https://example.com)!";
const links = parseLinks(text);
console.log(links);
```

### Node.js (CommonJS)

```javascript
const { parseLinks } = require("linkity");

const text = "Check [[Page]] and [link](https://example.com)!";
const links = parseLinks(text);
console.log(links);
```

### Browser (ESM)

```html
<script type="module">
  import { parseLinks } from "./node_modules/linkity/dist/index.browser.mjs";

  const links = parseLinks(document.body.textContent);
  console.log(links);
</script>
```

## API

### `parseLinks(text: string, options?: LinkityParseOptions): LinkNode[]`

Parses input text and returns an array of LinkNode ASTs for all detected links.

**Options:**

- `enableWikilink?: boolean` - Enable wikilink parsing (default: `true`)
- `enableMarkdown?: boolean` - Enable markdown link parsing (default: `true`)
- `enableUrl?: boolean` - Enable raw URL parsing (default: `true`)
- `customSchemes?: string[]` - Additional URL schemes to recognize

**Example:**

```typescript
import { parseLinks } from "linkity";

const text = "Check [[Page]] and https://example.com";
const links = parseLinks(text, {
  enableMarkdown: false,
  customSchemes: ["obsidian", "vscode"]
});

console.log(links);
```

### `detectLinkType(str: string): LinkType | null`

Detects the link type from a string.

**Returns:** `"wikilink" | "markdown" | "url" | "custom" | null`

### Types

```typescript
interface LinkNode {
  type: LinkType;
  value: string;
  alias?: string;
  url?: string;
  position?: {
    start: number;
    end: number;
  };
  data?: Record<string, any>;
}

**Output Example:**

```json
[
  {
    "type": "wikilink",
    "value": "Page",
    "position": { "start": 6, "end": 14 }
  },
  {
    "type": "url",
    "value": "https://example.com",
    "position": { "start": 19, "end": 38 }
  }
]
```

```markdown

## Examples

See the `examples/` directory for more usage examples:

- `basic-usage.mjs` - Node.js example
- `browser-usage.html` - Browser example

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Project Structure

```text
linkity/
├── src/
│   ├── index.ts           # Main entry point
│   ├── types/             # TypeScript type definitions
│   ├── parsers/           # Link parsers (wikilink, markdown, url)
│   └── utils/             # Utility functions
├── test/                  # Test files
├── examples/              # Usage examples
├── docs/                  # Documentation
└── dist/                  # Build output (generated)
```

## License

MIT © [Your Name]

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
