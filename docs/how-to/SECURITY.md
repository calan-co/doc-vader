---
title: Security Policy
id: wi-74145
summary: Security best practices, reporting, and review process for Team-in-a-Box.
type: work-item
subtype: task
lifecycle: draft
status: proposed
priority: medium
estimated: 4
---

## Best Practices

- Never commit `.env` files
- Use restrictive permissions (`chmod 600`)
- Store secrets in `~/.tiab/config/.env`
- Rotate keys regularly
- Validate all user input and file paths
- Use schema validation for all agent/workflow files

## Reporting Vulnerabilities

- Contact maintainers via [Support](./support.md)
- Disclose privately before public reporting

## Security Review

- Regularly audit dependencies for vulnerabilities
- Review authentication and authorization flows
- Monitor logs for suspicious activity
