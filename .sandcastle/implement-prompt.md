# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `node --input-type=module -e 'import{readFileSync,readdirSync}from"node:fs";import path from"node:path";const dir="backlog",needle=String(process.argv[1]??"").replace(/^wi-/,"");function clean(v){return String(v??"").trim().replace(/^[\"\x27]|[\"\x27]$/g,"")}function split(raw){const m=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);return m?{fm:m[1],body:raw.slice(m[0].length)}:{fm:"",body:raw}}function parse(text){const data={};let top=null,obj=data,key=null;for(const raw of text.split(/\r?\n/)){if(!raw.trim()||raw.trim().startsWith("#"))continue;let m=raw.match(/^([A-Za-z0-9_$-]+):(?:\s*(.*))?$/);if(m){top=m[1];const val=(m[2]??"").trim();data[top]=val?clean(val):[];obj=data;key=top;continue}m=raw.match(/^  ([A-Za-z0-9_$-]+):(?:\s*(.*))?$/);if(m&&top){if(Array.isArray(data[top]))data[top]={};obj=data[top];key=m[1];const val=(m[2]??"").trim();obj[key]=val?clean(val):[];continue}m=raw.match(/^\s*-\s*(.*)$/);if(m&&obj&&key&&Array.isArray(obj[key]))obj[key].push(clean(m[1]))}return data}function arr(v){return Array.isArray(v)?v:[]}function sections(body){const ms=[...body.matchAll(/^##\s+(.+)$/gm)];return ms.map((m,i)=>({heading:m[1].trim(),content:body.slice(m.index+m[0].length,ms[i+1]?.index??body.length).trim()}))}for(const file of readdirSync(dir).filter(f=>f.endsWith(".md")).sort()){const raw=readFileSync(path.join(dir,file),"utf8");const{fm,body}=split(raw);const data=parse(fm);const id=clean(data.id||"").replace(/^wi-/,"");if(id===needle||file.replace(/\.md$/,"")===needle||file.startsWith(needle+"-")){const sec=sections(body);console.log(JSON.stringify({id,number:id,title:clean(data.title||id),body:body.trim(),status:clean(data.status||""),state:["completed","aborted","closed"].includes(clean(data.status||""))?"closed":"open",priority:clean(data.priority||""),tags:arr(data.tags),dependencies:arr((data.links??{}).depends_on),references:arr((data.links??{}).reference),file:path.join(dir,file),frontmatter:data,bodySections:sec.map(s=>({heading:s.heading,content:s.content}))},null,2));process.exit(0)}}console.error("No markdown issue found for "+needle);process.exit(1)' {{TASK_ID}}`. If it has a parent PRD, pull that in too.

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

# COMPLETION EVIDENCE

Before outputting `<promise>COMPLETE</promise>`, update the task file for
`{{TASK_ID}}` on branch `{{BRANCH}}`:

1. Mark every completed item in `## Tasks` with `[x]`.
2. Mark every satisfied item in `## Acceptance Criteria` with `[x]`.
3. Set frontmatter `status: completed`.
4. Set frontmatter `status_reason: completed`.
5. Set `completed_date` to today's ISO date.
6. Commit this backlog update as the final commit on the feature branch.

Do not mark the task complete unless every task and acceptance criterion is
actually satisfied by the branch. If anything remains incomplete, leave it
unchecked, leave the status non-completed, explain the blocker, and do not emit
`<promise>COMPLETE</promise>`.

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

If the task is not complete, leave a note in your final response with what was
done and what remains.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
