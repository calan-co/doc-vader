# Schemas

This directory contains JSON schemas for validating various document types in the Team-in-a-Box platform.

## Available Schemas

### Documentation Schemas

- **`story-frontmatter.schema.json`** - Schema for validating story file frontmatter

## Story Frontmatter Schema

The `story-frontmatter.schema.json` defines the required structure for YAML frontmatter in all `*.story.md` files.

### Required Fields

| Field                | Type    | Description                                                                   |
| -------------------- | ------- | ----------------------------------------------------------------------------- |
| `documentType`       | string  | Must be `"story"`                                                             |
| `created`            | string  | Creation date in YYYY-MM-DD format                                            |
| `updated`            | string  | Last update date in YYYY-MM-DD format                                         |
| `status`             | string  | One of: `draft`, `active`, `approved`, `completed`, `superseded`, `archived`  |
| `epic`               | integer | Epic number (≥1)                                                              |
| `storyNumber`        | integer | Story number within epic (≥1)                                                 |
| `title`              | string  | Full story title including epic context                                       |
| `storyStatement`     | string  | User story format: "As a [role], I want/need [capability] so that [benefit]." |
| `acceptanceCriteria` | array   | List of acceptance criteria strings (minimum 1)                               |
| `relatedDocs`        | array   | List of related documentation file paths                                      |
| `tags`               | array   | List of tags in kebab-case format (minimum 1)                                 |

### Example

```yaml
---
documentType: story
created: 2025-10-17
updated: 2025-10-19
status: completed
epic: 1
storyNumber: 1
title: "Foundation & Core Infrastructure: User Authentication Setup"
storyStatement: "As a user, I want to log in and manage my account so that I can securely access the system."
acceptanceCriteria:
  - Users can log in using their credentials.
  - Authentication tokens are validated for each request.
  - Users can manage their account details.
relatedDocs:
  - ../qa/gates/1.1-project-setup.yml
  - ../architecture/authentication-flow.md
  - ../prd/requirements.md
tags:
  - epic-1
  - authentication
  - keycloak
---
```

### Validation

Story frontmatter is validated automatically during:

1. **Linting**: Run `npm run stories:lint` to validate all story files
2. **Pre-commit hooks**: Validation runs automatically before git commits

### Common Validation Errors

#### Missing Required Field

```text
Missing required field: title
```

**Solution**: Add the missing field to the frontmatter.

#### Invalid Status

```text
status: must be equal to one of the allowed values
```

**Solution**: Use one of the valid status values: `draft`, `active`, `approved`, `completed`, `superseded`, `archived`

#### Invalid Story Statement Format

```text
storyStatement must follow format: "As a [role], I want/need [capability] so that [benefit]."
```

**Solution**: Ensure the story statement follows the user story format and includes all three parts.

#### Invalid Date Format

```text
created: must match pattern "^\d{4}-\d{2}-\d{2}$"
```

**Solution**: Use YYYY-MM-DD format (e.g., `2025-10-17`)

#### Invalid Tag Format

```text
tags/0: must match pattern "^[a-z0-9]+(-[a-z0-9]+)*$"
```

**Solution**: Use kebab-case format for tags (lowercase letters, numbers, and hyphens only)

## Schema Validation in Code

### Using the Story Frontmatter Schema

```javascript
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");

// Load schema
const schema = JSON.parse(
  fs.readFileSync("schemas/story-frontmatter.schema.json", "utf8")
);

// Create validator
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// Validate frontmatter
const frontmatter = {
  documentType: "story",
  created: "2025-10-17",
  // ... other fields
};

const valid = validate(frontmatter);
if (!valid) {
  console.error("Validation errors:", validate.errors);
}
```

## Contributing

When adding new document types that require validation:

1. Create a new JSON schema file in this directory
2. Follow JSON Schema Draft 7 specification
3. Add validation logic to the appropriate linter script
4. Update this README with documentation
5. Add example files to the `examples/` directory
