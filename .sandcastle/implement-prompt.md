# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `node --input-type=module -e 'import fs from "node:fs/promises";import path from "node:path";import matter from "gray-matter";const wanted=String(process.argv[1]||"");async function walk(dir){const out=[];for(const ent of await fs.readdir(dir,{withFileTypes:true})){if(ent.name.startsWith("."))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())out.push(...await walk(p));else if(ent.isFile()&&ent.name.endsWith(".md"))out.push(p)}return out}for(const file of await walk("backlog")){const raw=await fs.readFile(file,"utf8");const parsed=matter(raw);const d=parsed.data||{};const id=String(d.id||path.basename(file,".md"));const num=id.replace(/^wi-/,"");if(d.type==="work-item"&&(id===wanted||num===wanted||("wi-"+wanted)===id)){console.log(JSON.stringify({id,number:num,title:String(d.title||id),body:parsed.content.trim(),status:String(d.status||"open"),state:d.status==="closed"?"closed":"open",file:file.split(path.sep).join("/"),frontmatter:d},null,2));process.exit(0)}}console.error("Work item not found: "+wanted);process.exit(1)' {{TASK_ID}}`. If it has a parent PRD, pull that in too.

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
