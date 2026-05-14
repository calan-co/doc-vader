---
"@calan-co/doc-vader": patch
---

Add inbound-reference guard to backlog scan: archival of a work item is now blocked when any active backlog file references it via a wikilink. The resolver supports same-folder and nested-subfolder lookup, sorting candidates alphabetically then by depth distance from the source file.
