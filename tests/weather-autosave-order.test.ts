import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/weather-persistence.spec.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('weather-persistence.spec.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['savedWorld','expectSettledRain','nextBrowserAutosave']);
const helpers=ast.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&wanted.has(node.name?.text??'')).map(node=>node.getText(ast));
assert.equal(helpers.length,wanted.size);
const helperCode=ts.transpileModule(`${helpers.join('\n')}\nreturn nextBrowserAutosave;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function expectation(value:any){return{
 toBe:(expected:any)=>assert.equal(value,expected),toBeNull:()=>assert.equal(value,null),not:{toBeNull:()=>assert.notEqual(value,null)},
 toBeGreaterThanOrEqual:(expected:number)=>assert.ok(value>=expected),toBeLessThan:(expected:number)=>assert.ok(value<expected),
 toHaveAttribute:async(name:string,expected:string)=>assert.equal(value.attributes[name],expected)
};}
function fixture(){
 const order:string[]=[],frame={},attributes:Record<string,string>={'data-persistence-revision':'7','data-persistence-conflict':'false'};
 const meta={day:4,minuteOfDay:800,weather:'rain',weatherEpoch:2};let stored={revision:7,snapshot:{meta}},handler:any;
 const page={url:()=> 'http://localhost:5173/',mainFrame:()=>frame,locator:()=>({attributes}),
  route:async(_url:string,value:any)=>{handler=value;order.push('route armed');},
  unroute:async(_url:string,value:any)=>{assert.equal(value,handler);handler=undefined;order.push('route removed');}};
 const request={get:async()=>({ok:()=>true,json:async()=>stored})};
 function candidate({resourceType='fetch',requestFrame=frame,revision=8,expectedRevision=7,status=200}={}){
  const counters={continued:0,bodyReads:0,responseReads:0};let acknowledge!:()=>void;const sent=new Promise<void>(r=>{acknowledge=r;});
  const response={status:()=>status,finished:async()=>null,json:async()=>({revision})};
  const outgoing={method:()=> 'POST',resourceType:()=>resourceType,frame:()=>requestFrame,
   postDataJSON:()=>{counters.bodyReads++;return{expectedRevision,snapshot:{meta}};},
   response:async()=>{counters.responseReads++;await sent;return response;}};
  return{counters,outgoing,route:{request:()=>outgoing,continue:async()=>{counters.continued++;attributes['data-persistence-revision']=String(revision);stored={revision,snapshot:{meta}};acknowledge();}}};
 }
 const observer=new Function('expect',helperCode)(expectation);
 return{candidate,dispatch:(c:ReturnType<typeof candidate>)=>handler(c.route),observe:(start:()=>Promise<void>)=>observer(page,request,start),order,attributes};
}
for(const phase of ['initial','reloaded'])test(`${phase} autosave checkpoint keeps later ACK behind the exact revision assertion`,async()=>{
 const f=fixture(),first=f.candidate(),later=f.candidate({revision:9,expectedRevision:8});let laterDone!:Promise<void>;
 const saved=await f.observe(async()=>{f.order.push('native action');const sent=f.dispatch(first);laterDone=f.dispatch(later);await sent;assert.equal(later.counters.continued,0);});
 await laterDone;assert.equal(saved.revision,8);assert.equal(saved.storedRevision,8);
 assert.equal(f.attributes['data-persistence-revision'],'9');assert.equal(later.counters.continued,1);
 assert.deepEqual(f.order,['route armed','native action','route removed']);
});
test('checkpoint excludes unload beacons and other frames',async()=>{
 const f=fixture(),ping=f.candidate({resourceType:'ping'}),foreign=f.candidate({requestFrame:{}}),fresh=f.candidate();
 const saved=await f.observe(async()=>{await f.dispatch(ping);await f.dispatch(foreign);await f.dispatch(fresh);});
 assert.equal(saved.revision,8);assert.equal(ping.counters.bodyReads,0);assert.equal(foreign.counters.bodyReads,0);assert.equal(fresh.counters.bodyReads,1);
});
test('wrong CAS acknowledgement fails and releases the later request',async()=>{
 const f=fixture(),invalid=f.candidate({revision:9}),later=f.candidate({revision:10,expectedRevision:9});let laterDone!:Promise<void>;
 await assert.rejects(f.observe(async()=>{const sent=f.dispatch(invalid);laterDone=f.dispatch(later);await sent;}),assert.AssertionError);
 await laterDone;assert.equal(later.counters.continued,1);assert.equal(f.order.at(-1),'route removed');
});
test('failed autosave remains a failure and removes interception',async()=>{
 const f=fixture(),invalid=f.candidate({status:409});await assert.rejects(f.observe(async()=>{await f.dispatch(invalid);}),assert.AssertionError);
 assert.equal(f.order.at(-1),'route removed');
});
test('native startup failure releases intercepted saves',async()=>{
 const f=fixture(),first=f.candidate(),later=f.candidate({revision:9,expectedRevision:8});let laterDone!:Promise<void>;
 await assert.rejects(f.observe(async()=>{await f.dispatch(first);laterDone=f.dispatch(later);throw new Error('startup failed');}),/startup failed/);
 await laterDone;assert.equal(later.counters.continued,1);assert.equal(f.order.at(-1),'route removed');
});
