---
title: Getting Started
lastReviewed: 2025-10-21T00:00:00.000Z
id: template
type: work-item
subtype: template
lifecycle: draft
status: proposed
---

## Getting Started

Welcome to Team-in-a-Box! This guide will help you install, configure, and run your first virtual team.

1. **Installation**

   ```bash
   npm install
   cd team-in-a-box-backend && npm install
   ```

2. **Configuration**

   Create your TIAB home directory and environment file:

   ```bash
   mkdir -p ~/.tiab/config
   touch ~/.tiab/config/.env
   chmod 600 ~/.tiab/config/.env
   ```

   Add your API keys and settings to `.env`:

   ```bash
   PORT=3000
   TIAB_HOME=/Users/youruser/.tiab
   OPENAI_API_KEY=your_key_here
   ANTHROPIC_API_KEY=your_key_here
   NODE_ENV=development
   ```

3. **Running the Platform**

   Start the backend:

   ```bash
   cd team-in-a-box-backend
   npm start
   ```

4. **Creating Your First Agent**

   Use the CLI or create a YAML file in `examples/agents/`:

   ```yaml
   apiVersion: tiab.dev/v1
   kind: Agent
   metadata:
     name: analyst
   spec:
     role: Analyst
     persona:
       role: Holistic Analyst
       style: Direct
       identity: Data-driven
       focus: Discovery
       principles:
         - Strategy before execution
         - Evidence-based decisions
     inputFormat: markdown
     outputFormat: json
   ```

5. **Running Tests**

   ```bash
   npm test
   cd team-in-a-box-backend && npm test
   ```

6. **Next Steps**

   - See [FAQ](./faq.md) for common questions
   - See [Troubleshooting](./troubleshooting.md) for help
   - Explore [Example Files](../../examples/README.md)

```bash

```
