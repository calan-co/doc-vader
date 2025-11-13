---
title: Troubleshooting Guide
lastReviewed: 2025-10-21T00:00:00.000Z
id: template
type: work-item
subtype: template
lifecycle: draft
status: proposed
---

## Troubleshooting Guide

## Common Issues

### Permissions

- Ensure your `.env` file is set to `chmod 600`.
- If you get permission errors, check file ownership and access rights.

### Environment Variables Not Loading

- Check that your environment file is in one of the supported locations.
- Use `echo $TIAB_HOME` to verify the environment variable is set.

### Tests Failing

- Run `npm test` in both the root and backend folders.
- Check for missing dependencies with `npm install`.

### Agents/Workflows Not Found

- Confirm files are in the correct folder and use kebab-case naming.
- Validate files with the CLI before use.

### Backend Won't Start

- Check for port conflicts (default is 3000).
- Ensure all required environment variables are set.

## More Help

- See [FAQ](./faq.md) or [Support](./support.md).
