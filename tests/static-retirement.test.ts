import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {StreamedPresentation} from '../src/scene/streamedPresentation.js';
import {disposeFarmCropRows} from '../src/scene/farmCrops.js';
import {retireResources} from '../src/scene/retireResources.js';
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),nodes:ts.Node[]=[];
function visit(n:ts.Node){nodes.push(n);ts.forEachChild(n,visit);}visit(ast);
const property=nodes.find((n):n is ts.PropertyDeclaration=>ts.isPropertyDeclaration(n)&&n.name.getText(ast)==='streamedPresentation')!;
const hostExpression=(property.initializer as ts.NewExpression).arguments![0] as ts.ObjectLiteralExpression;
const release=(hostExpression.properties.find(p=>p.name?.getText(ast)==='release') as ts.PropertyAssignment).initializer.getText(ast);
const method=(name:string)=>nodes.find((n):n is ts.MethodDeclaration=>ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)!;
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const releaseFor=(host:any)=>new Function('retireResources','disposeFarmCropRows',compile(`return (${release});`)).call(host,retireResources,disposeFarmCropRows) as (id:string,objects:any[])=>void;
function caught(fn:()=>void):any{try{fn();}catch(e){return e;}assert.fail('expected failure');}
function leaves(e:any):any[]{return e instanceof AggregateError?e.errors.flatMap(leaves):[e];}
const object=(id:string,owner='owner')=>({state:{id,chunkId:owner},mesh:new THREE.Group()}) as any;
const layout=(id:string,ids:string[],owner='owner')=>({unit:{id,bounds:{}},ownerCellIds:[owner],buildings:[],roads:[],objects:ids.map(id=>({id,ownerCellId:owner}))}) as any;
function manager(release:(id:string,objects:any[])=>void,create?:(entry:any)=>any){const objects=new Map<string,any>();const p=new StreamedPresentation({objects,create:entry=>{const o=create?create(entry):object(entry.plan.id,entry.plan.ownerCellId);objects.set(o.state.id,o);return o;},release});return {p,objects};}
test('rollback dual failure preserves ordered error identities and terminal registries',()=>{
 const createError={},cleanupError={};let fail=true;const {p,objects}=manager(()=>{throw cleanupError;},entry=>{if(entry.plan.id==='b'&&fail)throw createError;return object(entry.plan.id);});p.activate('owner');
 const e=caught(()=>p.present(layout('u',['a','b']),[]));assert.equal(leaves(e)[0],createError);assert.equal(leaves(e)[1],cleanupError);assert.equal(leaves(e).length,2);assert.equal(p.object('a'),undefined);assert.equal(p.physicsOwner('a'),undefined);assert.equal(objects.has('a'),false);assert.deepEqual(p.unitIds(),[]);fail=false;p.present(layout('u',['a','b']),[]);assert.ok(p.object('a'));
});
test('rollback single failure retains original object, including empty creation',()=>{
 for(const ids of [['a','b'],['b']]){const error={};const {p}=manager(()=>{},entry=>{if(entry.plan.id==='b')throw error;return object(entry.plan.id);});assert.equal(caught(()=>p.present(layout('u',ids),[])),error);assert.equal(p.object('a'),undefined);}
});
test('retirement snapshot continues after errors and retains visible and active units',()=>{
 const calls:string[]=[],error={};const {p}=manager(id=>{calls.push(id);if(id==='u')throw error;});for(const id of ['u','v','w','x'])p.present(layout(id,[id],id),[]);p.activate('x');
 assert.deepEqual(leaves(caught(()=>p.retainVisible(new Set(['w'])))),[error]);assert.deepEqual(calls,['u','v']);assert.deepEqual(p.unitIds(),['w','x']);for(const id of ['u','v']){assert.equal(p.object(id),undefined);assert.equal(p.physicsOwner(id),undefined);}p.retainVisible(new Set(['w']));assert.deepEqual(calls,['u','v']);
});
test('release reentry replaces same unit and object without stale deletion',()=>{
 let replacement:any,reentered=false;const {p,objects}=manager(()=>{if(reentered)return;reentered=true;p.retainVisible(new Set());p.present(layout('u',['a']),[]);replacement=p.object('a');});p.activate('owner');p.present(layout('u',['a']),[]);p.deactivate('owner');p.retainVisible(new Set());assert.equal(p.object('a'),replacement);assert.ok(replacement);assert.equal(p.physicsOwner('a'),'u');assert.deepEqual(p.unitIds(),['u']);p.activate('owner');assert.equal(objects.get('a'),replacement);
});
test('rollback release reentry preserves same-id replacement',()=>{
 const error={};let fail=true,reentered=false;const {p,objects}=manager(()=>{if(reentered)return;reentered=true;fail=false;p.present(layout('u',['a']),[]);},entry=>{if(entry.plan.id==='b'&&fail)throw error;return object(entry.plan.id);});p.activate('owner');assert.equal(caught(()=>p.present(layout('u',['a','b']),[])),error);assert.ok(p.object('a'));assert.equal(objects.get('a'),p.object('a'));assert.equal(p.physicsOwner('a'),'u');assert.deepEqual(p.unitIds(),['u']);
});
function resourceFixture(fail:string[]){
 const calls:string[]=[],errors=new Map(fail.map(k=>[k,{operation:k}]));const step=(name:string)=>{calls.push(name);if(errors.has(name))throw errors.get(name);};
 const parent=new THREE.Group(),a=object('a'),b=object('b'),road=object('road');
 const sharedGeometry=new THREE.BufferGeometry(),texture=new THREE.Texture(),sharedMaterial=new THREE.MeshBasicMaterial({map:texture});let shared=0;for(const r of [sharedGeometry,sharedMaterial,texture])r.addEventListener('dispose',()=>shared++);
 for(const o of [a,b]){const rows=new THREE.InstancedMesh(sharedGeometry,sharedMaterial,1);rows.userData.farmCropRows=true;rows.addEventListener('dispose',()=>step(o.state.id));o.mesh.add(rows);}
 const geometry=new THREE.BufferGeometry(),m1=new THREE.MeshBasicMaterial(),m2=new THREE.MeshBasicMaterial();geometry.addEventListener('dispose',()=>step('geometry'));m1.addEventListener('dispose',()=>step('m1'));m2.addEventListener('dispose',()=>step('m2'));road.mesh=new THREE.Mesh(geometry,[m1,m2]);road.mesh.userData.layoutRoad=true;
 parent.add(a.mesh,b.mesh,road.mesh);const remove=parent.remove.bind(parent);parent.remove=(...os:THREE.Object3D[])=>{for(const o of os)step(o===a.mesh?'detachA':o===b.mesh?'detachB':'detachRoad');return remove(...os);};
 const survivor={group:new THREE.Group()};const host={visualTargets:[{group:a.mesh.children[0]},{group:b.mesh},{group:road.mesh},survivor],physics:{clearChunk(id:string){assert.equal(id,'u');step('physics');}}};return {a,b,road,host,survivor,calls,errors,shared:()=>shared};
}
test('real main release continues farm/detach/road material failures, never releases shared templates',()=>{
 for(const fail of [['a'],['detachA'],['geometry'],['m1'],['a','detachA','geometry','m1','physics']]){const f=resourceFixture(fail);const e=caught(()=>releaseFor(f.host)('u',[f.a,f.b,f.road]));assert.deepEqual(new Set(leaves(e)),new Set(f.errors.values()));for(const op of ['a','b','detachA','detachB','detachRoad','geometry','m1','m2','physics'])assert.ok(f.calls.includes(op),op);assert.deepEqual(f.host.visualTargets,[f.survivor]);assert.equal(f.shared(),0);assert.equal(f.b.mesh.parent,null);assert.equal(f.road.mesh.parent,null);if(!fail.includes('detachA'))assert.equal(f.a.mesh.parent,null);}
});
test('real main release preserves state created reentrantly by dispose listener',()=>{
 const f=resourceFixture([]);const fresh={group:new THREE.Group()};let physics='old';f.host.physics.clearChunk=()=>{physics='cleared';};f.a.mesh.children[0].addEventListener('dispose',()=>{f.host.visualTargets.push(fresh);physics='new';});releaseFor(f.host)('u',[f.a]);assert.ok(f.host.visualTargets.includes(fresh));assert.equal(physics,'new');
});
test('real main static-retain tail always attempts actor sync and retains both errors',()=>{
 const statements=method('syncStreamedPresentation').body!.statements;const tail=statements.slice(statements.at(-1)!.getText(ast).startsWith('retireResources(')?-1:-2).map(n=>n.getText(ast)).join('\n');const first={},second={};let actors=0;
 const host={streamedPresentation:{retainVisible(){throw first;}},syncKnownActorPresentation(){actors++;throw second;}};const e=caught(()=>new Function('retireResources','units',compile(tail)).call(host,retireResources,new Map()));assert.equal(actors,1);assert.equal(leaves(e)[0],first);assert.equal(leaves(e)[1],second);assert.equal(leaves(e).length,2);
});
test('real outer main error handling blocks persistence and subsequent materialization',()=>{
 const failure=new AggregateError([{}],'static retirement failure');let calls=0,clears=0;const logs:string[]=[];const host={streamedLayoutError:'',persistenceLoadBlocked:false,streamedPresentation:{unitIds:()=>[]},syncStreamedPresentation(){calls++;throw failure;},clearMovablePersistenceQueue(){clears++;},log(s:string){logs.push(s);}};
 const invoke=new Function('i18n',compile(`return function()${method('updateFineChunkMaterialization').body!.getText(ast)};`))({t:(_key:string,args:any)=>args.error});invoke.call(host);invoke.call(host);assert.equal(calls,1);assert.equal(clears,1);assert.equal(host.persistenceLoadBlocked,true);assert.equal(host.streamedLayoutError,failure.message);assert.deepEqual(logs,[failure.message]);
});

test('integrated rollback uses real main callback: both errors, detach, targets and physics converge',()=>{
 const f=resourceFixture(['a']);const createError={create:true};const release=releaseFor(f.host);
 const {p,objects}=manager(release,entry=>{if(entry.plan.id==='b')throw createError;return f.a;});p.activate('owner');
 const e=caught(()=>p.present(layout('u',['a','b']),[]));assert.equal(leaves(e)[0],createError);assert.equal(leaves(e)[1],f.errors.get('a'));assert.equal(leaves(e).length,2);assert.equal(f.a.mesh.parent,null);assert.ok(f.calls.includes('physics'));assert.equal(p.object('a'),undefined);assert.equal(objects.get('a'),undefined);assert.equal(p.physicsOwner('a'),undefined);assert.deepEqual(p.unitIds(),[]);assert.ok(!f.host.visualTargets.some(t=>t.group===f.a.mesh.children[0]));assert.equal(f.shared(),0);
});
test('retain stable snapshot does not visit a newly added unit',()=>{
 const calls:string[]=[];const {p}=manager(id=>{calls.push(id);if(id==='u')p.present(layout('new',['new']),[]);});p.present(layout('u',['a']),[]);p.present(layout('v',['b']),[]);p.retainVisible(new Set());assert.deepEqual(calls,['u','v']);assert.deepEqual(p.unitIds(),['new']);assert.equal(p.physicsOwner('new'),'new');
});
test('nested release failures retain their unflattened structure',()=>{
 const createError={},inner=new AggregateError([{}],'inner');const {p}=manager(()=>{throw inner;},()=>{throw createError;});const e=caught(()=>p.present(layout('u',['a']),[]));assert.ok(e instanceof AggregateError);assert.equal(e.errors[0],createError);assert.equal(e.errors[1],inner);
});
