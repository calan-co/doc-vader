# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `node --input-type=module -e 'import fs from "node:fs/promises";import path from "node:path";import matter from "gray-matter";const wanted=String(process.argv[1]||"");async function walk(dir){const out=[];for(const ent of await fs.readdir(dir,{withFileTypes:true})){if(ent.name.startsWith("."))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())out.push(...await walk(p));else if(ent.isFile()&&ent.name.endsWith(".md"))out.push(p)}return out}function isAfk(d){const tags=Array.isArray(d.tags)?d.tags.map(String):[];return d.type==="work-item"&&d.status==="ready"&&tags.includes("afk")&&!tags.includes("hitl")}for(const file of await walk("backlog")){const posix=file.split(path.sep).join("/");if(posix.includes("/archive/")||posix.includes("/records/"))continue;const raw=await fs.readFile(file,"utf8");const parsed=matter(raw);const d=parsed.data||{};const id=String(d.id||path.basename(file,".md"));const num=id.replace(/^wi-/,"");if(d.type==="work-item"&&(id===wanted||num===wanted||("wi-"+wanted)===id)){if(!isAfk(d)){console.error("Refusing non-AFK Sandcastle task: "+num+" (status="+String(d.status||"unknown")+", tags="+JSON.stringify(Array.isArray(d.tags)?d.tags:[])+")");process.exit(3)}console.log(JSON.stringify({id,number:num,title:String(d.title||id),body:parsed.content.trim(),status:String(d.status||"open"),state:d.status==="closed"?"closed":"open",tags:Array.isArray(d.tags)?d.tags.map(String):[],file:posix,frontmatter:d},null,2));process.exit(0)}}console.error("AFK work item not found: "+wanted);process.exit(1)' {{TASK_ID}}`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `pnpm run typecheck` and `pnpm run test` to ensure the tests pass.

# COMPLETION EVIDENCE

Before reporting completion:

1. Review the work item's `## Tasks` and `## Acceptance Criteria`.
2. Change a checkbox to `[x]` only when the repository contains direct implementation evidence and passing verification for that line.
3. Leave any unproven checkbox as `[ ]` and report it as remaining work.
4. Run `pnpm run docs:lint`, `pnpm run backlog:validate`, `pnpm run backlog:validate:ci`, and `pnpm run test`.
5. Do not transition the work item to `ready-for-review` or `closed` while any `## Tasks` or `## Acceptance Criteria` checkbox remains unchecked.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
