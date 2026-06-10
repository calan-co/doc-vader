# ISSUES

Here are the open issues in the repo:

<issues-json>

!`node --input-type=module -e 'import fs from "node:fs/promises";import path from "node:path";import matter from "gray-matter";async function walk(dir){const out=[];for(const ent of await fs.readdir(dir,{withFileTypes:true})){if(ent.name.startsWith("."))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())out.push(...await walk(p));else if(ent.isFile()&&ent.name.endsWith(".md"))out.push(p)}return out}const items=[];for(const file of await walk("backlog")){const posix=file.split(path.sep).join("/");if(posix.includes("/archive/")||posix.includes("/records/"))continue;const raw=await fs.readFile(file,"utf8");const parsed=matter(raw);const d=parsed.data||{};if(d.type==="work-item"&&d.status!=="closed"){const id=String(d.id||path.basename(file,".md"));items.push({id,number:id.replace(/^wi-/,""),title:String(d.title||id),body:parsed.content.trim(),status:String(d.status||"open"),state:"open",file:posix})}}console.log(JSON.stringify(items,null,2))'`

</issues-json>

The list above has already been filtered to issues ready for work.

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the exact format `sandcastle/issue-{id}` (no slug or other suffix). This must be deterministic so that re-planning the same issue always produces the same branch name and accumulated progress is preserved.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).

Always emit the `<plan>` tags, even when there is nothing to do. If there are no issues to work on at all, output `<plan>{"issues": []}</plan>` so the run can exit cleanly.
