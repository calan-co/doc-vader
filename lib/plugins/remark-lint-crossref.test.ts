import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkLintCrossref, CrossrefOptionsSchema } from './remark-lint-crossref';

const sampleMarkdown = `
[Link to file](./existing-file.md)
[Broken link](./missing-file.md)
`;

describe('remarkLintCrossref', () => {
  it('should validate options with zod', () => {
    expect(() => CrossrefOptionsSchema.parse({ enabled: true })).not.toThrow();
  });

  // Integration tests for file existence would require mocking fs
  it('should skip lint if disabled', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkLintCrossref, { enabled: false });
    const file = await processor.process(sampleMarkdown);
    expect(file.messages.length).toBe(0);
  });
});
