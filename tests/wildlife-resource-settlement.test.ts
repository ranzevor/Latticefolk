import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

type Vec2={x:number;z:number};
type Plants=Record<'grass'|'shrub'|'fruit'|'crop',number>;
const plantKeys=['grass','shrub','fruit','crop'] as const;
interface FixtureOptions {
  stock?:number;target?:string;species?:string;action?:string;kind?:string;tags?:string[];
  distance?:number;plants?:Partial<Plants>;visible?:boolean;present?:boolean;
}
interface Animal {
  state:{id:string;species:string;hunger:number;thirst:number;energy:number;position:Vec2;chunkId:string;phenotype:unknown;currentAction?:string;targetObjectId?:string};
  path:Vec2[];pathIndex:number;actionResolved:boolean;nextDecisionAt?:number;
}
interface ResourceObject {
  state:{id:string;kind:string;tags:string[];position:Vec2;resourceAmount?:number};
  mesh:{visible:boolean};
}

const mainAst=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const speciesAst=ts.createSourceFile('wildlifeSpecies.ts',fs.readFileSync(new URL('../src/world/wildlifeSpecies.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['applyWildlifeDecision','findWildlifeResource','completeWildlifeAction']);
const methods:string[]=[];
for(const node of mainAst.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame'){
  for(const member of node.members)if(ts.isMethodDeclaration(member)&&names.has(member.name.getText(mainAst)))methods.push(member.getText(mainAst));
}
assert.equal(methods.length,names.size);
function variable(name:string){
  for(const node of speciesAst.statements)if(ts.isVariableStatement(node)){
    for(const declaration of node.declarationList.declarations)if(declaration.name.getText(speciesAst)===name&&declaration.initializer)return declaration.initializer;
  }
  throw new Error(`Missing species variable: ${name}`);
}
function property(object:ts.ObjectLiteralExpression,name:string){
  const value=object.properties.find((node):node is ts.PropertyAssignment=>ts.isPropertyAssignment(node)&&node.name.getText(speciesAst)===name);
  assert(value);return value.initializer;
}
const registry=variable('WILDLIFE_SPECIES_PROFILES');assert(ts.isObjectLiteralExpression(registry));
const profiles:Record<string,{feedingAction:string;forageTags:string[];plantConsumptionWeights:Record<string,number>}>=Object.fromEntries(['rabbit','badger','fox'].map(name=>{
  const body=property(registry,name);assert(ts.isObjectLiteralExpression(body));
  const action=property(body,'feedingAction');assert(ts.isStringLiteral(action));
  const tags=property(body,'forageTags');assert(ts.isArrayLiteralExpression(tags));
  let weights=property(body,'plantConsumptionWeights');if(ts.isIdentifier(weights))weights=variable(weights.text);assert(ts.isObjectLiteralExpression(weights));
  const values=Object.fromEntries(weights.properties.map(entry=>{
    assert(ts.isPropertyAssignment(entry));const value=Number(entry.initializer.getText(speciesAst));assert(Number.isFinite(value));return [entry.name.getText(speciesAst),value];
  }));
  return [name,{feedingAction:action.text,forageTags:tags.elements.map(tag=>{assert(ts.isStringLiteral(tag));return tag.text;}),plantConsumptionWeights:values}];
}));
const lookup=speciesAst.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='wildlifeSpeciesProfile');assert(lookup);
const code=ts.transpileModule(`${lookup.getText(speciesAst).replace(/^export /,'')}\nreturn class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const deps={
  WILDLIFE_SPECIES_PROFILES:profiles,
  clamp:(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value)),
  dist:(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z),
  now:()=>1000,
  beginRandomEvent:()=>()=>.5,
  normalizeWildlifePhenotype:(value:unknown)=>value,
  wildlifeFunctionalPhenotype:()=>({forageEfficiency:1,recoveryEfficiency:1,fastActionEnergyMultiplier:1,movementEnergyMultiplier:1}),
  normalizeWildlifeOrganismGenome:()=>({}),
  wildlifeGenomePlantConsumptionWeights:(species:string)=>({...profiles[species].plantConsumptionWeights}),
  wildlifeResourceNicheScore:()=>0
};
const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps));

function grazeFixture({stock,target='food',distance=0,plants:initialPlants={}}:FixtureOptions={}){
  const game=new Runtime();
  const animal:Animal={state:{id:'rabbit_synthetic',species:'rabbit',hunger:80,thirst:30,energy:60,position:{x:0,z:0},chunkId:'0,0',phenotype:{}},path:[],pathIndex:0,actionResolved:false};
  const object:ResourceObject|undefined=stock===undefined?undefined:{state:{id:'food',kind:'bush',tags:['nature','food','grass'],position:{x:distance,z:0},resourceAmount:stock},mesh:{visible:true}};
  const plants:Plants={grass:0,shrub:0,fruit:0,crop:0,...initialPlants};
  game.objects=new Map(object?[['food',object]]:[]);
  game.coarseWorld={chunks:new Map([['0,0',{plants}]])};
  game.wildlife=new Map();
  game.findPath=(from:Vec2,to:Vec2)=>Math.hypot(from.x-to.x,from.z-to.z)===0?[]:[{...to}];
  const before={hunger:animal.state.hunger,stock:object?.state.resourceAmount,plants:{...plants}};
  return {game,animal,object,plants,target:target as string|undefined,before};
}
function observeGraze(name:string,f:ReturnType<typeof grazeFixture>){
  const row={name,before:f.before,after:{hunger:f.animal.state.hunger,stock:f.object?.state.resourceAmount,plants:{...f.plants},action:f.animal.state.currentAction,resolved:f.animal.actionResolved,nextDecisionAt:f.animal.nextDecisionAt},hungerRelief:f.before.hunger-f.animal.state.hunger,objectConsumed:(f.before.stock??0)-(f.object?.state.resourceAmount??0),plantConsumed:plantKeys.reduce((sum,k)=>sum+f.before.plants[k]-f.plants[k],0)};
  return row;
}
function applyGraze(f:ReturnType<typeof grazeFixture>){f.game.applyWildlifeDecision(f.animal,{wildlifeId:f.animal.state.id,source:'fallback',action:'graze',targetObjectId:f.target,confidence:1,reasonCode:'synthetic_hunger'});}
test('zero stock cannot grant hunger relief without positive consumption',()=>{
  const f=grazeFixture({stock:0});applyGraze(f);const row=observeGraze('zero-stock',f);
  assert.equal(row.objectConsumed+row.plantConsumed,0);
  assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);
  assert.equal(row.hungerRelief,0,'zero stock must not grant hunger relief');
});
test('no target and zero coarse biomass cannot grant hunger relief',()=>{
  const f=grazeFixture({target:undefined});f.target=undefined;applyGraze(f);const row=observeGraze('no-target-zero-biomass',f);
  assert.equal(row.objectConsumed+row.plantConsumed,0);
  assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);
  assert.equal(row.hungerRelief,0,'zero biomass must not grant hunger relief');
});
test('already missing decision target cannot turn into free hunger relief',()=>{
  const f=grazeFixture({target:'missing'});applyGraze(f);const row=observeGraze('missing-at-apply',f);
  assert.equal(row.objectConsumed+row.plantConsumed,0);
  assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);
  assert.equal(row.hungerRelief,0,'missing target must not grant hunger relief');
});
test('positive stock grants normal relief and consumes one quarter unit',()=>{
  const f=grazeFixture({stock:2});applyGraze(f);const row=observeGraze('positive-stock',f);
  assert.equal(row.objectConsumed,0.25);assert.equal(row.plantConsumed,0);assert.equal(row.hungerRelief,34);assert.equal(row.after.hunger,46);assert.equal(row.after.stock,1.75);
});
test('explicit target lost after planning preserves the explicit-target completion guard',()=>{
  const f=grazeFixture({stock:2,distance:1});applyGraze(f);assert.equal(f.animal.state.hunger,80);assert.equal(f.animal.path.length,1);
  f.game.objects.delete('food');f.animal.path=[];f.game.completeWildlifeAction(f.animal);const row=observeGraze('lost-after-planning',f);
  assert.equal(row.hungerRelief,0);assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.after.action,'rest');assert.equal(row.after.resolved,true);
});

test('positive edible coarse vegetation retains the original fixed relief and weights',()=>{
  const f=grazeFixture({plants:{grass:2,shrub:2}});f.target=undefined;applyGraze(f);const row=observeGraze('positive-coarse-vegetation',f);
  assert.equal(row.objectConsumed,0);assert(Math.abs(row.plantConsumed-.35*(.72+.154))<1e-10);
  assert(Math.abs(row.after.plants.grass-(2-.35*.72))<1e-10);assert(Math.abs(row.after.plants.shrub-(2-.35*.154))<1e-10);
  assert.equal(row.hungerRelief,34);assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);
});
test('positive vegetation on zero-consumption axes cannot grant relief',()=>{
  const f=grazeFixture({plants:{fruit:.1,crop:.2}});f.target=undefined;applyGraze(f);const row=observeGraze('zero-consumption-axes',f);
  assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);
  assert.equal(row.hungerRelief,0,'unchanged vegetation cannot grant hunger relief');
});
for(const [name,kind,tags]of [['non-food','rock',['mineral']],['water','well',['nature','water']],['parcel','dropped_item',['nature','food','grass']]] as [string,string,string[]][]){
  test(`${name} explicit completion target retains the food-eligibility guard`,()=>{
    const f=grazeFixture({stock:2});assert(f.object);f.object.state.kind=kind;f.object.state.tags=tags;
    f.animal.state.currentAction='graze';f.animal.state.targetObjectId='food';f.game.completeWildlifeAction(f.animal);const row=observeGraze(`${name}-guard`,f);
    assert.equal(row.hungerRelief,0);assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.after.action,'rest');assert.equal(row.after.resolved,true);
  });
}


function forageFixture({species='badger',stock,target,plants={}}:FixtureOptions={}){
  assert.equal(profiles[species].feedingAction,'forage');
  const game=new Runtime();
  const animal:Animal={state:{id:`${species}_forage_synthetic`,species,hunger:80,thirst:30,energy:60,position:{x:0,z:0},chunkId:'0,0',phenotype:{}},path:[],pathIndex:0,actionResolved:false};
  const object:ResourceObject|undefined=stock===undefined?undefined:{state:{id:'food',kind:'bush',tags:['forage','food'],position:{x:0,z:0},resourceAmount:stock},mesh:{visible:true}};
  const vegetation:Plants={grass:0,shrub:0,fruit:0,crop:0,...plants};
  game.objects=new Map(object?[['food',object]]:[]);game.coarseWorld={chunks:new Map([['0,0',{plants:vegetation}]])};game.wildlife=new Map();
  game.findPath=(from:Vec2,to:Vec2)=>{assert.deepEqual(from,to);return [];};
  if(object)assert(profiles[species].forageTags.some(tag=>object.state.tags.includes(tag)),'normal forage forageFixture must match the actual species food tags');
  return {game,animal,object,plants:vegetation,target:target??object?.state.id,before:{hunger:80,stock:object?.state.resourceAmount,plants:{...vegetation}}};
}
function applyForage(f:ReturnType<typeof forageFixture>){f.game.applyWildlifeDecision(f.animal,{wildlifeId:f.animal.state.id,source:'fallback',action:'forage',targetObjectId:f.target,confidence:1,reasonCode:'synthetic_forage_branch'});}
function observeForage(name:string,f:ReturnType<typeof forageFixture>){
  const row={name,species:f.animal.state.species,action:'forage',entry:f.object?'apply -> compatible chosen object -> complete':'apply -> actual find(empty map) -> complete',before:f.before,after:{hunger:f.animal.state.hunger,stock:f.object?.state.resourceAmount,plants:{...f.plants},resolved:f.animal.actionResolved,nextDecisionAt:f.animal.nextDecisionAt},hungerRelief:f.before.hunger-f.animal.state.hunger,objectConsumed:(f.before.stock??0)-(f.object?.state.resourceAmount??0),plantConsumed:plantKeys.reduce((sum,k)=>sum+f.before.plants[k]-f.plants[k],0)};
  return row;
}
function closedForage(row:ReturnType<typeof observeForage>){assert.equal(row.after.resolved,true);assert.equal(row.after.nextDecisionAt,14000);}
test('compatible badger forage with positive object stock keeps 28 relief',()=>{
  const f=forageFixture({stock:2});applyForage(f);const row=observeForage('badger-positive-object-forage',f);closedForage(row);
  assert.equal(row.objectConsumed,.25);assert.equal(row.plantConsumed,0);assert.equal(row.hungerRelief,28);assert.equal(row.after.hunger,52);assert.equal(row.after.stock,1.75);
});
test('compatible badger forage with zero object stock grants no relief',()=>{
  const f=forageFixture({stock:0});applyForage(f);const row=observeForage('badger-zero-stock-forage',f);closedForage(row);
  assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.hungerRelief,0,'forage without actual consumption cannot grant 28 relief');
});
test('badger forage without an object and with zero biomass grants no relief',()=>{
  const f=forageFixture();applyForage(f);const row=observeForage('badger-zero-biomass-forage',f);closedForage(row);
  assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.hungerRelief,0,'zero biomass cannot support forage relief');
});
test('badger forage consumes legal coarse plants and keeps 28 relief',()=>{
  const f=forageFixture({plants:{grass:2,shrub:2,fruit:2,crop:2}});applyForage(f);const row=observeForage('badger-positive-vegetation-forage',f);closedForage(row);
  assert.equal(row.objectConsumed,0);const weights=profiles.badger.plantConsumptionWeights;
  for(const key of plantKeys)assert(Math.abs(row.after.plants[key]-(2-.35*weights[key]))<1e-10);
  assert(Math.abs(row.plantConsumed-.105)<1e-10);assert.equal(row.hungerRelief,28);assert.equal(row.after.hunger,52);
});
test('legal fox forage with positive biomass but zero plant consumption weights grants no relief',()=>{
  const f=forageFixture({species:'fox',plants:{grass:2,shrub:2,fruit:2,crop:2}});applyForage(f);const row=observeForage('fox-positive-biomass-zero-consumption-forage',f);closedForage(row);
  assert.equal(row.objectConsumed+row.plantConsumed,0);assert.equal(row.hungerRelief,0,'positive unchanged biomass is not actual forage consumption');
});


function guardFixture({species='rabbit',action='graze',stock,kind='bush',tags=['nature','food','grass'],distance=0,plants={}}:FixtureOptions={}){
  const game=new Runtime();
  const animal:Animal={state:{id:`${species}_guard_synthetic`,species,hunger:80,thirst:30,energy:60,currentAction:action,position:{x:0,z:0},chunkId:'0,0',phenotype:{}},path:[],pathIndex:0,actionResolved:false};
  const object:ResourceObject|undefined=stock===undefined?undefined:{state:{id:'source',kind,tags,position:{x:distance,z:0},resourceAmount:stock},mesh:{visible:true}};
  const vegetation:Plants={grass:0,shrub:0,fruit:0,crop:0,...plants};
  game.objects=new Map(object?[['source',object]]:[]);game.coarseWorld={chunks:new Map([['0,0',{plants:vegetation}]])};game.wildlife=new Map();
  game.findPath=(from:Vec2,to:Vec2)=>Math.hypot(from.x-to.x,from.z-to.z)===0?[]:[{...to}];
  return {game,animal,object,plants:vegetation,before:{hunger:80,stock:object?.state.resourceAmount,plants:{...vegetation}}};
}
function applyGuard(f:ReturnType<typeof guardFixture>){f.game.applyWildlifeDecision(f.animal,{wildlifeId:f.animal.state.id,source:'fallback',action:f.animal.state.currentAction,targetObjectId:f.object?.state.id,confidence:1,reasonCode:'synthetic_guard_neighbor'});}
function completeGuardExplicit(f:ReturnType<typeof guardFixture>){assert(f.object);f.animal.state.targetObjectId=f.object.state.id;f.game.completeWildlifeAction(f.animal);}
function guardSnapshot(name:string,f:ReturnType<typeof guardFixture>){
 const d={name,species:f.animal.state.species,before:f.before,after:{hunger:f.animal.state.hunger,stock:f.object?.state.resourceAmount,plants:{...f.plants},action:f.animal.state.currentAction,resolved:f.animal.actionResolved,nextDecisionAt:f.animal.nextDecisionAt},relief:80-f.animal.state.hunger,objectConsumed:(f.before.stock??0)-(f.object?.state.resourceAmount??0),plantsConsumed:plantKeys.reduce((n,k)=>n+f.before.plants[k]-f.plants[k],0)};
 return d;
}
function assertGuardRejected(d:ReturnType<typeof guardSnapshot>){assert.equal(d.relief,0);assert.equal(d.objectConsumed+d.plantsConsumed,0);assert.equal(d.after.action,'rest');assert.equal(d.after.resolved,true);}
test('non-food explicit target is assertGuardRejected before stock or hunger changes',()=>{const f=guardFixture({stock:2,kind:'rock',tags:['nature','resource','stone']});completeGuardExplicit(f);assertGuardRejected(guardSnapshot('non-food-explicit',f));});
test('water explicit target is assertGuardRejected before stock or hunger changes',()=>{const f=guardFixture({stock:2,kind:'well',tags:['water','town','social']});completeGuardExplicit(f);assertGuardRejected(guardSnapshot('water-explicit',f));});
test('target lost after planning follows the parcel-style rest outcome',()=>{
 const f=guardFixture({stock:2,distance:1});applyGuard(f);assert.equal(f.animal.path.length,1);assert.equal(f.animal.state.hunger,80);f.game.objects.delete('source');f.animal.path=[];f.game.completeWildlifeAction(f.animal);assertGuardRejected(guardSnapshot('lost-after-plan',f));
});
test('normal graze retains one-quarter consumption and 34 relief',()=>{const f=guardFixture({stock:2});applyGuard(f);const d=guardSnapshot('valid-graze',f);assert.equal(d.relief,34);assert.equal(d.objectConsumed,.25);assert.equal(d.after.hunger,46);assert.equal(d.after.stock,1.75);assert.equal(d.after.nextDecisionAt,14000);});
test('normal species-compatible forage retains one-quarter consumption and 28 relief',()=>{const f=guardFixture({species:'badger',action:'forage',stock:2,kind:'food_stall',tags:['food','trade','market']});applyGuard(f);const d=guardSnapshot('valid-forage',f);assert.equal(d.relief,28);assert.equal(d.objectConsumed,.25);assert.equal(d.after.hunger,52);assert.equal(d.after.stock,1.75);});
test('no explicit target still consumes legal coarse vegetation with the original weights',()=>{const f=guardFixture({plants:{grass:2,shrub:2}});applyGuard(f);const d=guardSnapshot('valid-coarse-vegetation',f);assert.equal(d.relief,34);assert.equal(d.objectConsumed,0);assert(Math.abs(d.plantsConsumed-.3059)<1e-10);assert.equal(d.after.nextDecisionAt,14000);});
test('zero stock retains the positive-actual-consumption gate and normal resolved tail',()=>{const f=guardFixture({stock:0});applyGuard(f);const d=guardSnapshot('zero-stock',f);assert.equal(d.relief,0);assert.equal(d.objectConsumed+d.plantsConsumed,0);assert.equal(d.after.action,'graze');assert.equal(d.after.resolved,true);assert.equal(d.after.nextDecisionAt,14000);});
test('parcel completion guard remains unchanged',()=>{const f=guardFixture({stock:2,kind:'dropped_item',tags:['nature','food','grass']});completeGuardExplicit(f);assertGuardRejected(guardSnapshot('parcel-guard',f));});
test('a plant outside the source species food tags cannot be consumed by explicit forage intent',()=>{const f=guardFixture({species:'fox',action:'forage',stock:2,kind:'field',tags:['crop']});completeGuardExplicit(f);assertGuardRejected(guardSnapshot('incompatible-plant-diet',f));});
test('a food object becoming invisible after planning is rechecked at settlement',()=>{const f=guardFixture({stock:2,distance:1});applyGuard(f);assert.equal(f.animal.path.length,1);assert(f.object);f.object.mesh.visible=false;f.animal.path=[];f.game.completeWildlifeAction(f.animal);assertGuardRejected(guardSnapshot('invisible-after-plan',f));});

function drinkFixture({stock,kind='well',tags=['water','town','social'],distance=0,visible=true,present=true}:FixtureOptions={}){
 const game=new Runtime();const animal:Animal={state:{id:'rabbit_water_synthetic',species:'rabbit',hunger:30,thirst:85,energy:60,currentAction:'wander',position:{x:0,z:0},chunkId:'0,0',phenotype:{}},path:[],pathIndex:0,actionResolved:false};
 const object:ResourceObject={state:{id:'water_source',kind,tags,position:{x:distance,z:0},...(stock===undefined?{}:{resourceAmount:stock})},mesh:{visible}};
 game.objects=new Map(present?[[object.state.id,object]]:[]);game.coarseWorld={chunks:new Map([['0,0',{plants:{grass:0,shrub:0,fruit:0,crop:0}}]])};game.wildlife=new Map();
 game.findPath=(from:Vec2,to:Vec2)=>Math.hypot(from.x-to.x,from.z-to.z)===0?[]:[{...to}];
 return {game,animal,object,before:{thirst:85,energy:60,stock:object.state.resourceAmount}};
}
function applyDrink(f:ReturnType<typeof drinkFixture>){f.game.applyWildlifeDecision(f.animal,{wildlifeId:f.animal.state.id,source:'fallback',action:'drink',targetObjectId:'water_source',confidence:1,reasonCode:'synthetic_water_intent'});}
function drinkSnapshot(name:string,f:ReturnType<typeof drinkFixture>){const row={name,before:f.before,after:{thirst:f.animal.state.thirst,energy:f.animal.state.energy,stock:f.object.state.resourceAmount,action:f.animal.state.currentAction,target:f.animal.state.targetObjectId,resolved:f.animal.actionResolved},thirstRelief:85-f.animal.state.thirst,resourceDeducted:(f.before.stock??0)-(f.object.state.resourceAmount??0)};return row;}
test('missing water target at applyDrink cannot relieve thirst',()=>{const f=drinkFixture({present:false});applyDrink(f);const d=drinkSnapshot('missing-at-applyDrink',f);assert.equal(d.thirstRelief,0,'no current water source cannot grant drink relief');});
test('hidden last water target at applyDrink cannot relieve thirst',()=>{const f=drinkFixture({visible:false});applyDrink(f);const d=drinkSnapshot('hidden-at-applyDrink',f);assert.equal(d.thirstRelief,0,'hidden source rejected by find cannot grant drink relief');});
test('water target lost after planning cannot relieve thirst',()=>{const f=drinkFixture({distance:1});applyDrink(f);assert.equal(f.animal.state.thirst,85);assert.equal(f.animal.path.length,1);f.game.objects.delete('water_source');f.animal.path=[];f.game.completeWildlifeAction(f.animal);const d=drinkSnapshot('lost-after-plan',f);assert.equal(d.thirstRelief,0,'a target absent at settlement cannot grant drink relief');});
test('an explicit target that is no longer water cannot relieve thirst',()=>{const f=drinkFixture({kind:'rock',tags:['nature','resource','stone']});applyDrink(f);const d=drinkSnapshot('changed-to-nonwater',f);assert.equal(d.thirstRelief,0,'the explicit object must still qualify as water');});
test('normal visible well without resourceAmount retains existing 58 relief',()=>{const f=drinkFixture();applyDrink(f);const d=drinkSnapshot('normal-well-no-quantity',f);assert.equal(d.thirstRelief,58);assert.equal(d.after.thirst,27);assert.equal(d.after.energy,59);assert.equal(d.resourceDeducted,0);assert.equal(d.after.resolved,true);});
