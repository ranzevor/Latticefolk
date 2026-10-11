import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../e2e/playable-smoke.spec.ts',import.meta.url),'utf8');
const start=source.indexOf('  let capturedAt=0;',source.indexOf("test('coarse policy reply"));
const end=source.indexOf("  await page.route('**/api/world/chunks/decide'",start);
assert.ok(start>=0&&end>start);
const setup=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const run=new Function('page',`return (async()=>{${setup}\nawait page.route();})();`) as (page:unknown)=>Promise<void>;

for(const failure of [undefined,'Profiler.enable','Profiler.start'])test(`coarse profiling setup ${failure??'success'} precedes request capture`,async()=>{
  const events:string[]=[];
  const page={context:()=>({async newCDPSession(){events.push('session');return {async send(command:string){events.push(command);if(command===failure)throw new Error(command);}};}}),async route(){events.push('capture');}};
  if(failure)await assert.rejects(run(page),new RegExp(failure));else await run(page);
  assert.deepEqual(events,failure==='Profiler.enable'?['session','Profiler.enable']:failure==='Profiler.start'?['session','Profiler.enable','Profiler.start']:['session','Profiler.enable','Profiler.start','capture']);
});
