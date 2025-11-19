import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkLintChecklist, ChecklistOptionsSchema } from './remark-lint-checklist';

const sampleMarkdown = `
- [ ] Item 1
- [x] Item 2
`;

describe('remarkLintChecklist', () => {
  it('should pass when required items are present', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkLintChecklist, { enabled: true, requiredItems: ['Item 1', 'Item 2'] });
    const file = await processor.process(sampleMarkdown);
    expect(file.messages.length).toBe(0);
  });

  it('should report missing required items', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkLintChecklist, { enabled: true, requiredItems: ['Item 3'] });
    const file = await processor.process(sampleMarkdown);
    expect(file.messages.some(m => m.message.includes('Required checklist item missing'))).toBe(true);
  });

  it('should validate options with zod', () => {
    expect(() => ChecklistOptionsSchema.parse({ enabled: true, requiredItems: [] })).toThrow();
  });
});
