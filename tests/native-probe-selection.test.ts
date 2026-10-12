import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../e2e/helpers/native-input-probe.ts',import.meta.url),'utf8');
const script=source.replace(/^import .*;\n/gm,'').replace(/^export \{expect\};\n/gm,'').replace(/^export type .*;\n/gm,'').replace('export const test=','const test=');
const code=ts.transpileModule(script+'\ntest;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const selected=[
 'coarse policy reply crossing a real materialize-unload transition is discarded and retry recovers',
 'real playable scene keeps God View observer-only and uses authoritative ground',
 'ordinary walking crosses the home edge into the visible layout and preserves it through return and reload',
 'saved actors stay visible across an internal owner boundary and reload without expanding fine simulation',
 'late wildlife intent cannot mutate a rematerialized entity or consume its saved cursor'
];
for(const setting of [undefined,'0','1'])for(const title of [...selected,'unrelated scene'])test(`native route fixture selection ${setting??'unset'} ${title}`,async()=>{
 const fixture=vm.runInNewContext(code,{base:{extend:(value:unknown)=>value},process:{env:{LATTICEFOLK_NATIVE_INPUT_PROBE:setting}},performance:{timeOrigin:0},Buffer,console:{info(){}}}).nativeInputProbe[0];
 const bindings:string[]=[],attachments:string[]=[];let scripts=0,used=0,detached=0;
 const session={detach:async()=>{detached++;}};
 const page={context:()=>({newCDPSession:async()=>session}),exposeBinding:async(name:string)=>{bindings.push(name);},addInitScript:async()=>{scripts++;},isClosed:()=>false};
 await fixture({page},async()=>{used++;},{title,attach:async(name:string)=>{attachments.push(name);}});
 assert.equal(used,1);
 const expected=selected.includes(title);
 assert.deepEqual(bindings,expected?['__latticeNativePulse','__latticeNativeProbeRecord']:[]);
 assert.equal(scripts,Number(expected));assert.equal(detached,Number(expected));assert.equal(attachments.length,Number(expected));
});

