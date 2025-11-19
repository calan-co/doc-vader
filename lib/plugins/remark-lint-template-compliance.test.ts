import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkLintTemplateCompliance, TemplateComplianceOptionsSchema } from './remark-lint-template-compliance';

const sampleMarkdown = `
# Heading 1
# Heading 2
`;

describe('remarkLintTemplateCompliance', () => {
  it('should pass when required headings are present', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkLintTemplateCompliance, { enabled: true, requiredHeadings: ['Heading 1', 'Heading 2'] });
    const file = await processor.process(sampleMarkdown);
    expect(file.messages.length).toBe(0);
  });

  it('should report missing required headings', async () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkLintTemplateCompliance, { enabled: true, requiredHeadings: ['Heading 3'] });
    const file = await processor.process(sampleMarkdown);
    expect(file.messages.some(m => m.message.includes('Missing required heading'))).toBe(true);
  });

  it('should validate options with zod', () => {
    expect(() => TemplateComplianceOptionsSchema.parse({ enabled: true, requiredHeadings: [] })).toThrow();
  });
});
