import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/helpers/native-input-probe.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('probe.ts',source,ts.ScriptTarget.Latest,true);
let init:ts.Expression|undefined;
function visit(node:ts.Node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addInitScript')init=node.arguments[0];
  ts.forEachChild(node,visit);
}
visit(ast);assert.ok(init);
const code=ts.transpileModule(`(${init.getText(ast)})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

test('native pulse release evidence rejects old or untrusted events and survives trace truncation',async()=>{
  let time=0,mode='trusted';
  const listeners=new Map<string,(event:unknown)=>void>();
  const world={dataset:{playerX:'0',playerZ:'0',playerInputSeconds:'0',simulationClock:'{}',characterSoles:'[]'}};
  const emit=(type:string,code:string,trusted=true)=>listeners.get(type)?.({type,code,repeat:false,timeStamp:++time,isTrusted:trusted});
  const root:any={async __latticeNativePulse(request:{codes:string[]}){
    if(mode==='stale')return {};
    if(mode==='skipped')return {skipped:true};
    for(const code of request.codes)emit('keydown',code);
    for(const code of request.codes)emit('keyup',code,mode!=='untrusted');
    return {};
  },async __latticeNativeProbeRecord(){}};
  vm.runInNewContext(code,{window:root,performance:{now:()=>time,timeOrigin:10000},document:{querySelector:()=>world,hasFocus:()=>true,hidden:false},
    addEventListener:(type:string,callback:(event:unknown)=>void)=>listeners.set(type,callback),requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  const probe=root.nativeInputProbe;
  probe.start({});
  const request={codes:['ShiftLeft','KeyD'],durationMs:200,deadlineEpochMs:20000};
  assert.equal((await probe.pulse(request)).releasedEventAt,4);
  mode='skipped';assert.equal((await probe.pulse(request)).releasedEventAt,undefined);
  mode='stale';await assert.rejects(probe.pulse(request),/trusted release/);
  mode='untrusted';await assert.rejects(probe.pulse(request),/trusted release/);
  mode='trusted';probe.start({});
  for(let i=0;i<2100;i++)emit('keyup','KeyA');
  assert.equal((await probe.pulse(request)).releasedEventAt,time);
  await probe.finish();
});
