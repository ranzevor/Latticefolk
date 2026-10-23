import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {StreamedActors} from '../src/scene/streamedActors.js';
import {retireResources} from '../src/scene/retireResources.js';
import {disposeOwnedSkeletons} from '../src/scene/ownedSkeletons.js';

// Execute source AST slices, not a second handwritten cleanup implementation.
// Full main has browser startup side effects; DOM methods below are explicit doubles.
const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const nodes:ts.Node[]=[];
function visit(node:ts.Node){nodes.push(node);ts.forEachChild(node,visit);}visit(ast);
const property=nodes.find((n):n is ts.PropertyDeclaration=>ts.isPropertyDeclaration(n)&&n.name.getText(ast)==='streamedNpcs')!;
assert.ok(property&&property.initializer&&ts.isNewExpression(property.initializer));
const callback=property.initializer.arguments![0].getText(ast);
const method=nodes.find((n):n is ts.MethodDeclaration=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='syncKnownActorPresentation')!;
const statements=method.body!.statements;
const tail=statements.slice(statements.at(-1)!.getText(ast).startsWith('retireResources(')?-1:-2).map(n=>n.getText(ast)).join('\n');
function compile(body:string){return ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;}
function releaseFor(host:object){return new Function('retireResources','disposeOwnedSkeletons',compile(`return (${callback});`)).call(host,retireResources,disposeOwnedSkeletons) as (actor:any)=>void;}
function retainBoth(host:object,owners:Set<string>){return new Function('retireResources','owners',compile(tail)).call(host,retireResources,owners);}
function caught(fn:()=>void){try{fn();assert.fail('expected failure');}catch(error){return error;}}
function aggregate(error:unknown):AggregateError{assert.ok(error instanceof AggregateError);return error;}
function fixture(fail:string[]=[]){
  const order:string[]=[];const failures=new Map(fail.map(k=>[k,{operation:k}]));
  const step=(name:string)=>{order.push(name);if(failures.has(name))throw failures.get(name);};
  const mesh=new THREE.Group(),parent=new THREE.Group();parent.add(mesh);
  const geometry=new THREE.BufferGeometry(),texture=new THREE.Texture(),material=new THREE.MeshBasicMaterial({map:texture});
  let sharedDisposals=0;for(const resource of [geometry,texture,material])resource.addEventListener('dispose',()=>sharedDisposals++);
  for(const name of ['skeleton1','skeleton2']){const skeleton=new THREE.Skeleton([]);skeleton.dispose=()=>step(name);const child=new THREE.SkinnedMesh(geometry,material);child.bind(skeleton);mesh.add(child);}
  const remove=mesh.removeFromParent.bind(mesh);mesh.removeFromParent=()=>{step('mesh');return remove();};
  const speechEl={parentNode:{},remove(){step('speech');this.parentNode=null as any;}};
  const nameEl={parentNode:{},remove(){step('name');this.parentNode=null as any;}};
  const mixer=new THREE.AnimationMixer(mesh);mixer.stopAllAction=()=>{step('stop');return mixer;};mixer.uncacheRoot=()=>step('uncache');
  const actor={state:{id:'a',chunkId:'old'},mesh,mixer,speechEl,nameEl};
  const survivor={group:new THREE.Group()};const host={visualTargets:[{group:mesh},survivor]};
  return {actor,host,survivor,order,failures,shared:()=>sharedDisposals};
}
test('NPC first skeleton failure still detaches real Three mesh, both DOM doubles and targets',()=>{
 const f=fixture(['skeleton1']);const error=aggregate(caught(()=>releaseFor(f.host)(f.actor)));
 assert.deepEqual(f.order,['stop','uncache','skeleton1','skeleton2','mesh','speech','name']);
 assert.equal(aggregate(error.errors[0]).errors[0],f.failures.get('skeleton1'));
 assert.equal(f.actor.mesh.parent,null);assert.equal(f.actor.speechEl.parentNode,null);assert.equal(f.actor.nameEl.parentNode,null);assert.deepEqual(f.host.visualTargets,[f.survivor]);assert.equal(f.shared(),0);
});
test('all cleanup actions isolated; original failures remain nested and ordered',()=>{
 const f=fixture(['stop','uncache','skeleton1','skeleton2','mesh','speech','name']);
 const error=aggregate(caught(()=>releaseFor(f.host)(f.actor)));
 assert.deepEqual(f.order,['stop','uncache','skeleton1','skeleton2','mesh','speech','name']);
 assert.deepEqual(error.errors,[f.failures.get('stop'),f.failures.get('uncache'),error.errors[2],f.failures.get('mesh'),f.failures.get('speech'),f.failures.get('name')]);
 assert.deepEqual(aggregate(error.errors[2]).errors,[f.failures.get('skeleton1'),f.failures.get('skeleton2')]);assert.deepEqual(f.host.visualTargets,[f.survivor]);assert.equal(f.shared(),0);
});
const actor=(id:string,chunkId='old')=>({state:{id,chunkId},mesh:new THREE.Group()});
test('batch continues after failure; active/visible retained; retry does not double release',()=>{
 const a=actor('a'),b=actor('b'),c=actor('c'),d=actor('d','visible');const calls:string[]=[];const failure={a:1};
 const manager=new StreamedActors<typeof a>(a=>{calls.push(a.state.id);if(a.state.id==='a')throw failure;});for(const x of [a,b,c,d])manager.remember(x);
 assert.deepEqual(aggregate(caught(()=>manager.retain(new Set(['visible']),new Map([['c',c]])))).errors,[failure]);
 assert.deepEqual(calls,['a','b']);assert.equal(manager.get('a'),undefined);assert.equal(manager.get('b'),undefined);assert.equal(manager.get('c'),c);assert.equal(manager.get('d'),d);
 manager.retain(new Set(['visible']),new Map([['c',c]]));assert.deepEqual(calls,['a','b']);
});
test('stable snapshot does not visit additions or remove same-id replacement',()=>{
 const a=actor('a'),b=actor('b'),replacement={...b},added=actor('new');const calls:string[]=[];
 const manager=new StreamedActors<typeof a>(x=>{calls.push(x.state.id);if(x===a){manager.remember(replacement);manager.remember(added);}});manager.remember(a);manager.remember(b);
 manager.retain(new Set(),new Map());assert.deepEqual(calls,['a']);assert.equal(manager.get('b'),replacement);assert.equal(manager.get('new'),added);
});
test('reentrant retain preserves identity and releases each original once',()=>{
 const a=actor('a'),b=actor('b');const calls:string[]=[];const failure={b:1};
 const manager=new StreamedActors<typeof a>(x=>{calls.push(x.state.id);if(x===a)manager.retain(new Set(),new Map());else throw failure;});manager.remember(a);manager.remember(b);
 const e=aggregate(caught(()=>manager.retain(new Set(),new Map())));assert.equal(aggregate(e.errors[0]).errors[0],failure);assert.deepEqual(calls,['a','b']);assert.deepEqual([...manager.values()],[]);
 manager.retain(new Set(),new Map());assert.deepEqual(calls,['a','b']);
});
test('stale remove false; current failure propagates once after registry deletion',()=>{
 const a=actor('a'),stale={...a};let count=0;const failure={remove:1};const manager=new StreamedActors<typeof a>(()=>{count++;throw failure;});manager.remember(a);
 assert.equal(manager.remove(stale),false);assert.equal(count,0);assert.equal(caught(()=>manager.remove(a)),failure);assert.equal(manager.get('a'),undefined);assert.equal(manager.remove(a),false);assert.equal(count,1);
});
test('cross-manager attempts both and preserves ordered unflattened errors',()=>{
 const first=new AggregateError([{npc:1}],'npc');const second={wildlife:1};const calls:string[]=[];const owners=new Set<string>();const npcs=new Map(),wildlife=new Map();
 const host={npcs,wildlife,streamedNpcs:{retain(o:unknown,a:unknown){assert.equal(o,owners);assert.equal(a,npcs);calls.push('npc');throw first;}},streamedWildlife:{retain(o:unknown,a:unknown){assert.equal(o,owners);assert.equal(a,wildlife);calls.push('wildlife');throw second;}}};
 const e=aggregate(caught(()=>retainBoth(host,owners)));assert.deepEqual(calls,['npc','wildlife']);assert.equal(e.errors[0],first);assert.equal(e.errors[1],second);
});
test('cross-manager wildlife success is still attempted after NPC failure',()=>{
 let reached=false;const failure={npc:1};const host={npcs:new Map(),wildlife:new Map(),streamedNpcs:{retain(){throw failure;}},streamedWildlife:{retain(){reached=true;}}};
 const e=aggregate(caught(()=>retainBoth(host,new Set())));assert.equal(reached,true);assert.deepEqual(e.errors,[failure]);
});
test('outer streamedLayoutError safety block remains present (static only)',()=>{
 assert.match(source,/if\(this\.streamedLayoutError\)return;/);assert.match(source,/this\.streamedLayoutError\s*=/);assert.match(source,/this\.persistenceLoadBlocked\s*=\s*true/);
});
test('exact outer main method catches cleanup failure, clears queue and blocks subsequent work',()=>{
 const outer=nodes.find((n):n is ts.MethodDeclaration=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='updateFineChunkMaterialization')!;
 const failure=new AggregateError([{cleanup:1}],'cleanup failed');let calls=0,clears=0;const logs:string[]=[];
 const host={streamedLayoutError:'',persistenceLoadBlocked:false,streamedPresentation:{unitIds:()=>[]},syncStreamedPresentation(){calls++;throw failure;},clearMovablePersistenceQueue(){clears++;},log(message:string){logs.push(message);}};
 const invoke=new Function('i18n',compile(`return function()${outer.body!.getText(ast)};`))({t:(_key:string,args:{error:string})=>args.error});
 invoke.call(host);assert.equal(host.persistenceLoadBlocked,true);assert.equal(host.streamedLayoutError,'cleanup failed');assert.equal(clears,1);assert.deepEqual(logs,['cleanup failed']);invoke.call(host);assert.equal(calls,1);assert.equal(clears,1);
});
test('main release callback wired through real manager is terminal on repeated removal',()=>{
 const f=fixture(['speech']);const release=releaseFor(f.host);const manager=new StreamedActors<typeof f.actor>(release);manager.remember(f.actor);
 const e=aggregate(caught(()=>manager.remove(f.actor)));assert.equal(e.errors[0],f.failures.get('speech'));assert.equal(f.actor.nameEl.parentNode,null);assert.equal(f.actor.mesh.parent,null);assert.equal(manager.get('a'),undefined);assert.equal(manager.remove(f.actor),false);assert.deepEqual(f.order,['stop','uncache','skeleton1','skeleton2','mesh','speech','name']);
});
