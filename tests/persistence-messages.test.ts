import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {StreamedLayoutValidationError} from '../src/world/streamedLayouts.js';
import {I18n,SUPPORTED_LOCALES} from '../src/i18n.js';
import {appendHudLog,visibleHudLogs,type HudLogEntry} from '../src/ui/hudDiagnostics.js';
import type {LocaleCode} from '../src/types.js';

// Execute the actual persistence methods without starting rendering or a server.
// Stubs supply only their I/O; no translated behavior is copied into the harness.
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['initializePersistence','saveWorldState','clearMovablePersistenceQueue','flushWorldBeacon','log']);
const methods:string[]=[];
function visit(node:ts.Node){
  if(ts.isMethodDeclaration(node)&&wanted.has(node.name.getText(ast)))methods.push(node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
}).outputText;
interface Runtime {
  logs:HudLogEntry[];persistenceReady:boolean;persistenceRevision:number;persistenceConflict:boolean;
  persistenceSaveInFlight:boolean;persistenceSaveQueued:boolean;movableDirty:boolean;
  movableSaveTimer:undefined;movableSaveRetryMs:number;lastPersistenceSaveAt:number;
  initializePersistence():Promise<void>;saveWorldState():Promise<void>;flushWorldBeacon():void;
  log(text:string,audience?:'player'|'developer'):void;
}
type Reply={status:number;data?:unknown};
function fixture(locale:LocaleCode,reply:Reply,beaconAccepted=false,hang=false){
  const i18n=new I18n(locale),requests:Array<{url:string;init?:RequestInit}>=[],acknowledged:number[]=[],retryDelays:number[]=[],restored:unknown[]=[],beacons:Array<{url:string;body:Blob}>=[];
  const snapshot={version:1,meta:{day:0},coarseChunks:[],fineChunks:[]};
  let deadline:(()=>void)|undefined;
  const setTimeout=(callback:()=>void)=>{deadline=callback;return 1;};
  const clearTimeout=()=>{deadline=undefined;};
  const fetch=async(url:string,init?:RequestInit)=>{requests.push({url,init});if(hang)await new Promise(()=>{});return{ok:reply.status>=200&&reply.status<300,status:reply.status,json:async()=>reply.data};};
  const navigator={sendBeacon:(url:string,body:Blob)=>{beacons.push({url,body});return beaconAccepted;}};
  const RuntimeClass=new Function(...Object.keys(worldRandom),'StreamedLayoutValidationError','i18n','fetch','navigator','Blob','TextEncoder','now','appendHudLog','setTimeout','clearTimeout',code)(...Object.values(worldRandom),StreamedLayoutValidationError,i18n,fetch,navigator,Blob,TextEncoder,()=>123,appendHudLog,setTimeout,clearTimeout);
  const runtime:Runtime=new RuntimeClass();
  const checkpoint={pending:false,capture:()=>17,acknowledge:(value:number)=>acknowledged.push(value)};
  Object.assign(runtime,{logs:[],persistenceReady:true,persistenceRevision:5,persistenceConflict:false,
    persistenceSaveInFlight:false,persistenceSaveQueued:false,movableDirty:true,movableSaveTimer:undefined,movableSaveRetryMs:1500,
    portables:{checkpoint},flushWildlifeHabitatExposure(){},buildWorldSnapshot:()=>snapshot,buildFinalWorldSnapshot:()=>snapshot,
    initializeWorld(){},restoreWorldState:(value:unknown)=>restored.push(value),updateFineChunkMaterialization(){},scheduleMovablePersistence:(delay:number)=>retryDelays.push(delay)});
  return{runtime,i18n,requests,acknowledged,retryDelays,restored,beacons,snapshot,checkpoint,expire:()=>{assert.ok(deadline);deadline();}};
}
const labels:Record<LocaleCode,{save:string;load:string;restored:string;newWorld:string;conflict:string;reload:string;beacon:string;invalidRevision:string;invalidAcknowledgement:string}>={
  'zh-CN':{save:'世界自动保存失败：',load:'世界存档加载失败',restored:'已恢复世界存档',newWorld:'未发现已有世界存档',conflict:'存档版本冲突',reload:'需要重新加载',beacon:'最终存档未进入浏览器发送队列',invalidRevision:'服务器返回了无效的存档版本',invalidAcknowledgement:'存档版本确认无效'},
  en:{save:'World autosave failed: ',load:'Failed to load saved world',restored:'Saved world restored',newWorld:'No saved world found',conflict:'Revision conflict',reload:'reload required',beacon:'Final save was not queued by the browser',invalidRevision:'Invalid persistence revision from server',invalidAcknowledgement:'Invalid persistence revision acknowledgement'},
  ja:{save:'ワールドの自動保存に失敗しました：',load:'ワールドの読み込みに失敗しました',restored:'保存済みワールドを復元しました',newWorld:'保存済みワールドが見つからない',conflict:'保存リビジョンが競合しています',reload:'再読み込みが必要です',beacon:'最後の保存がブラウザーの送信キューに追加されませんでした',invalidRevision:'サーバーから無効な保存リビジョンが返されました',invalidAcknowledgement:'保存リビジョンの確認応答が無効です'},
  es:{save:'Error al guardar automáticamente el mundo: ',load:'Error al cargar el mundo guardado',restored:'Mundo guardado restaurado',newWorld:'No se encontró un mundo guardado',conflict:'Conflicto de revisiones',reload:'es necesario volver a cargar',beacon:'El guardado final no se añadió a la cola de envío del navegador',invalidRevision:'El servidor devolvió una revisión de guardado no válida',invalidAcknowledgement:'Confirmación de revisión de guardado no válida'}
};
for(const {code:locale} of SUPPORTED_LOCALES){
  const expected=labels[locale];
  test(`${locale}: timed-out save uses its own translated warning and retains unconfirmed edits`,async()=>{
    const expectedTimeout:Record<LocaleCode,string>={
      'zh-CN':'保存请求超时，未确认的改动将保留',
      en:'Save request timed out; unacknowledged changes are retained',
      ja:'保存要求がタイムアウトしました。未確認の変更は保持されます',
      es:'La solicitud de guardado agotó el tiempo; se conservan los cambios sin confirmar'
    };
    const f=fixture(locale,{status:200},false,true);const saving=f.runtime.saveWorldState();f.expire();await saving;
    assert.equal(f.runtime.logs[0].text,expected.save+expectedTimeout[locale]);
    assert.equal(f.runtime.logs[0].audience,'player');assert.equal(f.runtime.persistenceRevision,5);
    assert.equal(f.runtime.movableDirty,true);assert.equal(f.runtime.persistenceSaveInFlight,false);
    assert.deepEqual(f.acknowledged,[]);assert.deepEqual(f.retryDelays,[1500]);
    assert.equal(f.requests[0].init?.signal?.aborted,true);
  });
  test(`${locale}: autosave HTTP error preserves code, retry and player warning`,async()=>{
    const f=fixture(locale,{status:503});await f.runtime.saveWorldState();
    assert.equal(f.runtime.logs[0].text,expected.save+'HTTP 503');assert.equal(f.runtime.logs[0].audience,'player');
    assert.equal(f.runtime.persistenceRevision,5);assert.equal(f.runtime.persistenceConflict,false);
    assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.runtime.movableDirty,true);
    assert.deepEqual(f.retryDelays,[1500]);assert.equal(f.runtime.movableSaveRetryMs,3000);assert.deepEqual(f.acknowledged,[]);
    assert.deepEqual(JSON.parse(String(f.requests[0].init?.body)),{snapshot:f.snapshot,expectedRevision:5});
    for(let i=0;i<200;i++)f.runtime.log(`telemetry ${i}`,'developer');
    assert.deepEqual(visibleHudLogs(f.runtime.logs,'firstPerson',false).map(x=>x.text),[expected.save+'HTTP 503']);
  });
  for(const known of [true,false])test(`${locale}: conflict ${known?'with':'without'} server revision remains terminal`,async()=>{
    const f=fixture(locale,{status:409,data:known?{currentRevision:42}:{}});await f.runtime.saveWorldState();
    const message=f.runtime.logs[0].text;assert.ok(message.startsWith(expected.save));assert.ok(message.includes(expected.conflict));assert.ok(message.includes(expected.reload));assert.ok(message.includes('5'));assert.equal(message.includes('42'),known);
    assert.equal(f.runtime.persistenceConflict,true);assert.equal(f.runtime.persistenceRevision,5);assert.equal(f.runtime.persistenceSaveQueued,false);assert.equal(f.runtime.persistenceSaveInFlight,false);assert.deepEqual(f.retryDelays,[]);assert.deepEqual(f.acknowledged,[]);
    await f.runtime.saveWorldState();f.runtime.flushWorldBeacon();assert.equal(f.requests.length,1);assert.equal(f.beacons.length,0);
  });
  test(`${locale}: load failure and invalid server revision retain ready-state fallback`,async()=>{
    for(const reply of [{status:503},{status:200,data:{revision:'invalid',snapshot:null}}]){
      const f=fixture(locale,reply);await f.runtime.initializePersistence();
      assert.ok(f.runtime.logs[0].text.startsWith(expected.load));assert.ok(f.runtime.logs[0].text.includes(reply.status===503?'HTTP 503':expected.invalidRevision));assert.equal(f.runtime.persistenceReady,true);assert.equal(f.runtime.lastPersistenceSaveAt,123);assert.equal(f.runtime.persistenceRevision,5);assert.equal(f.restored.length,0);
    }
  });
  test(`${locale}: successful restore and empty world retain zero and numeric context`,async()=>{
    const restored={version:1,meta:{day:0},coarseChunks:[{},{}],fineChunks:[{},{},{}]};
    const f=fixture(locale,{status:200,data:{revision:0,snapshot:restored}});await f.runtime.initializePersistence();
    assert.equal(f.runtime.persistenceRevision,0);assert.deepEqual(f.restored,[restored]);assert.ok(f.runtime.logs[0].text.startsWith(expected.restored));
    for(const value of ['0','2','3'])assert.ok(f.runtime.logs[0].text.includes(value));assert.doesNotMatch(f.runtime.logs[0].text,/\{\w+\}/);
    const empty=fixture(locale,{status:200,data:{revision:0,snapshot:null}});await empty.runtime.initializePersistence();assert.ok(empty.runtime.logs[0].text.startsWith(expected.newWorld));assert.ok(empty.runtime.logs[0].text.includes('0'));
  });
  test(`${locale}: successful save and invalid acknowledgement preserve transaction behavior`,async()=>{
    const good=fixture(locale,{status:200,data:{revision:6}});await good.runtime.saveWorldState();assert.equal(good.runtime.persistenceRevision,6);assert.deepEqual(good.acknowledged,[17]);assert.equal(good.runtime.movableDirty,false);assert.deepEqual(good.runtime.logs,[]);
    const bad=fixture(locale,{status:200,data:{revision:99}});await bad.runtime.saveWorldState();assert.equal(bad.runtime.persistenceRevision,5);assert.deepEqual(bad.acknowledged,[]);assert.equal(bad.runtime.logs[0].text,expected.save+expected.invalidAcknowledgement);assert.deepEqual(bad.retryDelays,[1500]);
  });
  test(`${locale}: rejected beacon keeps exact byte count and accepted beacon stays silent`,async()=>{
    const f=fixture(locale,{status:200});f.runtime.flushWorldBeacon();assert.equal(f.beacons.length,1);const payload=await f.beacons[0].body.text();const bytes=new TextEncoder().encode(payload).byteLength;
    assert.ok(f.runtime.logs[0].text.startsWith(expected.beacon));assert.ok(f.runtime.logs[0].text.includes(String(bytes)));assert.deepEqual(JSON.parse(payload),{snapshot:f.snapshot,expectedRevision:5});assert.equal(f.runtime.logs[0].audience,'player');
    const accepted=fixture(locale,{status:200},true);accepted.runtime.flushWorldBeacon();assert.equal(accepted.beacons.length,1);assert.deepEqual(accepted.runtime.logs,[]);
  });
}
test('new messages use the current existing I18n locale after repeated language changes',async()=>{
  const f=fixture('en',{status:503});
  for(const locale of ['en','ja','es','zh-CN','en'] as const){f.i18n.setLocale(locale);await f.runtime.saveWorldState();assert.equal(f.runtime.logs.at(-1)?.text,labels[locale].save+'HTTP 503');}
  assert.equal(f.runtime.logs[0].text,labels.en.save+'HTTP 503');assert.equal(f.requests.length,5);
});
test('every locale explicitly declares all persistence keys with identical interpolation fields',()=>{
  const text=fs.readFileSync(new URL('../src/i18n.ts',import.meta.url),'utf8');const parsed=ts.createSourceFile('i18n.ts',text,ts.ScriptTarget.Latest,true);const sets:Array<Record<string,string[]>>=[];
  for(const statement of parsed.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
    if(!['zh','en','ja','es'].includes(declaration.name.getText(parsed))||!declaration.initializer||!ts.isObjectLiteralExpression(declaration.initializer))continue;
    const fields:Record<string,string[]>={};
    for(const property of declaration.initializer.properties)if(ts.isPropertyAssignment(property)&&ts.isStringLiteral(property.name)&&ts.isStringLiteral(property.initializer)&&property.name.text.startsWith('persistence.'))fields[property.name.text]=[...property.initializer.text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
    assert.deepEqual(Object.keys(fields).sort(),[
      'persistence.saveFailed','persistence.conflict','persistence.conflictUnknown',
      'persistence.invalidAcknowledgement','persistence.invalidRevision','persistence.loadFailed',
      'persistence.newWorld','persistence.requestTimedOut','persistence.restored','persistence.beaconRejected'
    ].sort());sets.push(fields);
  }
  assert.equal(sets.length,4);for(const fields of sets)assert.deepEqual(fields,sets[0]);
});

