---
# yaml-language-server: $schema=schemas/frontmatter/document/latest.json
title: Contribution Standards
id: contribution-standards
type: document
subtype: standard
lifecycle: draft
status: proposed
---

## General Principles

- Write clean, readable, and maintainable code.
- Follow the DRY (Don't Repeat Yourself) principle.
- Ensure all code is properly documented.
- Prioritize readability over cleverness.

## Frontend Standards

- Use TypeScript for all frontend code.
- Use ECMAScript Modules (ESM)
- Follow the Next.js conventions for file structure and routing.
- Use CSS modules or styled-components for styling.
- Ensure all components are functional and reusable.
- Write unit tests for all components using Vite.js and React Testing Library.

## Backend Standards

- Use TypeScript for all backend code.
- Use ECMAScript Modules (ESM)
- Follow standard Node.js conventions for file structure.
- Use async/await for asynchronous operations.
- Ensure proper error handling and logging.

## Code Formatting

- Use Prettier for code formatting.
- Follow the ESLint rules defined in the project.
- Ensure consistent indentation (2 spaces).

## Git Standards

- Make frequent atomic, incremental commits
- Use meaningful commit messages.
- Follow the feature-branch workflow.
- Ensure all code is reviewed before merging.
- Write clear and concise pull request descriptions.

## Documentation

- Document all functions, classes, and modules using JSDoc.
- Maintain an up-to-date README file for each project.
- Use Markdown for all documentation files.
- Follow the Markdownlint rules defined in the project.
- Ensure consistent indentation (2 spaces).

## Security

- Avoid hardcoding sensitive information.
- Use environment variables for configuration.
- Regularly update dependencies to patch vulnerabilities.

## Performance

- Optimize database queries.
- Use caching where appropriate.
- Avoid blocking the event loop in Node.js.

## Testing

- Write unit tests using Vitest.
- Ensure 80% or higher test coverage, prioritizing critical execution paths
- Use integration tests to validate workflows.
- Automate tests in the CI/CD pipeline.
