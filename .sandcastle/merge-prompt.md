# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `pnpm run typecheck` and `pnpm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, close the merged issues, then make a single commit summarizing the merge and issue closures.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command. Replace `<ID>` with the issue id from the list below.

`node --input-type=module -e 'import{readFileSync,writeFileSync,readdirSync}from"node:fs";import path from"node:path";const dir="backlog",needle=String(process.argv[1]??"").replace(/^wi-/,"");function split(raw){const m=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);if(!m)throw new Error("Missing frontmatter");return{fm:m[1],body:raw.slice(m[0].length)}}function clean(v){return String(v??"").trim().replace(/^[\"\x27]|[\"\x27]$/g,"")}function idOf(fm,file){const m=fm.match(/^id:\s*(.+)$/m);return clean(m?.[1]??file.replace(/\.md$/,"")).replace(/^wi-/,"")}function setField(fm,key,value){const lines=fm.split(/\r?\n/);const i=lines.findIndex(l=>l.startsWith(key+":"));if(i>=0)lines[i]=key+": "+value;else lines.push(key+": "+value);return lines.join("\n")}for(const file of readdirSync(dir).filter(f=>f.endsWith(".md")).sort()){const filePath=path.join(dir,file);const raw=readFileSync(filePath,"utf8");const{fm,body}=split(raw);const id=idOf(fm,file);if(id===needle||file.replace(/\.md$/,"")===needle||file.startsWith(needle+"-")){const date=new Date().toISOString().slice(0,10);let next=setField(fm,"status","completed");next=setField(next,"status_reason","completed");next=setField(next,"completed_date","\""+date+"\"");writeFileSync(filePath,"---\n"+next+"\n---\n"+body,"utf8");console.log(JSON.stringify({id,number:id,title:clean(fm.match(/^title:\s*(.+)$/m)?.[1]??id),status:"completed",state:"closed",file:filePath,completed_date:date},null,2));process.exit(0)}}console.error("No markdown issue found for "+needle);process.exit(1)' <ID>`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
