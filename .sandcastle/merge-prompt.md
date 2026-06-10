# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `pnpm run typecheck` and `pnpm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`node --input-type=module -e 'import {transitionWorkItem} from "./dist/lib/work-management/index.js";const id=String(process.argv[1]||"");const effortArg=process.argv[2];if(!id){console.error("Usage: close <ID> [EFFORT]");process.exit(2)}const actual=effortArg===undefined?undefined:Number(effortArg);if(effortArg!==undefined&&Number.isNaN(actual)){console.error("EFFORT must be numeric");process.exit(2)}const result=await transitionWorkItem({id:id.startsWith("wi-")?id:"wi-"+id,status:"closed",statusReason:"completed",...(actual===undefined?{}:{actual}),consumerConfig:".doc-vader/backlog-consumer.json"});console.log(JSON.stringify(result,null,2))' <ID> [EFFORT]`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
