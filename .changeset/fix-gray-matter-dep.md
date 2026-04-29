---
"@calan-co/doc-vader": patch
---

Move `gray-matter` from devDependencies to dependencies. It is imported by published lib modules (`backlog`, `frontmatter`, `docs`, `diataxis`, `work-management`) and must be present at runtime when the package is installed as a global CLI.
