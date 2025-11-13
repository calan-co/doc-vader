---
title: Security Policy
lastReviewed: 2025-10-21T00:00:00.000Z
docType: guide
docSubType: policy
id: guide-security-policy
summary: Security best practices, reporting, and review process for Team-in-a-Box.
sensitivity: public
type: work-item
subtype: template
lifecycle: draft
status: proposed
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
