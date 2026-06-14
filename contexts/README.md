# JSON-LD Contexts

This directory contains [JSON-LD](https://json-ld.org/) context files that map
doc-vader frontmatter properties to semantic vocabulary terms.

## Files

| File | Applies to |
|---|---|
| [`base.context.json`](base.context.json) | Default fallback vocabulary context |
| [`dublin-core.context.json`](dublin-core.context.json) | Dublin Core term mappings |
| [`schema-org.context.json`](schema-org.context.json) | Schema.org namespace vocabulary |
| [`document.context.json`](document.context.json) | All documents (`type: document`) |
| [`work-item.context.json`](work-item.context.json) | Work items (`type: work-item`); extends `document.context.json` |

## Usage

Reference a context from your document frontmatter:

```yaml
"@context": "https://raw.githubusercontent.com/your-org/doc-vader/main/contexts/document.context.json"
"@type": "schema:TechArticle"
type: document
id: my-doc
title: My Document
```

Or configure globally in `.doc.json` so all documents of a given type receive
the context automatically:

```json
{
  "vocabularies": {
    "defaultContext": "contexts/base.context.json",
    "contexts": {
      "work-item": "contexts/work-item.context.json"
    }
  }
}
```

## Vocabulary namespace

Term | Namespace | Description
---|---|---
`schema:` | <https://schema.org/> | Schema.org standard vocabulary
`dv:` | <https://vocab.doc-vader.dev/> | doc-vader project vocabulary

The `dv:` namespace is reserved for project-specific terms not covered by
schema.org.  These terms are not yet published at that URL; the URL is a
forward-compatible identifier only.
