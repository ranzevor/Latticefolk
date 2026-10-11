import {type Request} from '@playwright/test';
import {test,expect,type APIRequestContext,type Page} from './helpers/native-input-probe.js';
import {driveNativeWaypoint} from './helpers/native-waypoint.js';
import type {CoarseChunkState,NpcState,WildlifeDecisionBatchRequest,WildlifeState,WorldPersistenceSnapshot} from '../src/types.js';
import {startFirstPerson} from './helpers/native-start.js';

const inventory={apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0};
const idle={source:'e2e-idle',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'fixture'};
const status=(page:Page)=>page.locator('#worldStatus');
const snapshot=(seed='latticefolk-default'):WorldPersistenceSnapshot=>({version:1,
  meta:{randomness:{version:1,seed},day:4,minuteOfDay:720,weather:'rain',weatherEpoch:2,playerPosition:{x:0,z:7},playerInventory:{...inventory}},
  coarseChunks:[],fineChunks:[],homeNpcs:[],homeObjects:[]});
async function readWorld(request:APIRequestContext){
  const response=await request.get('/api/world/state');expect(response.ok()).toBe(true);
  return response.json() as Promise<{revision:number;snapshot:WorldPersistenceSnapshot}>;
}
async function seedWorld(request:APIRequestContext,value:WorldPersistenceSnapshot){
  const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);
  const response=await request.post('/api/world/state',{data:{expectedRevision:(await reset.json()).revision,snapshot:value}});
  expect(response.ok()).toBe(true);return (await response.json()).revision as number;
}
async function autosave(page:Page,request:APIRequestContext){
  const outgoing=await page.waitForRequest(r=>r.url()===new URL('/api/world/state',page.url()).href&&r.method()==='POST'&&r.resourceType()==='fetch'&&r.frame()===page.mainFrame(),{timeout:45_000});
  const submitted=outgoing.postDataJSON() as {snapshot:WorldPersistenceSnapshot;expectedRevision:number};
  const response=await outgoing.response();expect(response).not.toBeNull();expect(response!.status()).toBe(200);expect(await response!.finished()).toBeNull();
  const revision=(await response!.json()).revision as number;expect(revision).toBe(submitted.expectedRevision+1);
  await expect(status(page)).toHaveAttribute('data-persistence-revision',String(revision));
  const stored=await readWorld(request);expect(stored.revision).toBe(revision);
  return{snapshot:submitted.snapshot,stored:stored.snapshot,revision};
}
async function nativeCrossing(page:Page,x:number,crossed:(x:number)=>boolean){
  const result=await page.evaluate(driveNativeWaypoint,{target:{x,z:1.2},timeoutMs:8000,tolerance:.2,maxInputSeconds:2});
  console.info('late-wildlife-crossing',JSON.stringify(result));
  expect(result.reached).toBe(true);expect(crossed(result.x)).toBe(true);
}

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));});
test.afterEach(async({page,request})=>{await page.close();const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);});

test('world seed and a completed NPC event cursor survive browser autosave and reload',async({page,request},info)=>{
  test.setTimeout(100_000);
  const seed=snapshot('e2e-saved-world-seed');
  const maker:NpcState={id:'yui',name:'Yui',role:'maker',position:{x:-18,z:6},home:{x:-21,z:12},mood:'calm',hunger:20,energy:80,social:50,money:123,
    inventory:[{kind:'wood',count:2}],relationships:{},memories:[],currentAction:'idle',goal:'live',lastDecisionAt:0,randomEventCursor:41};
  seed.homeNpcs=[maker];const revision=await seedWorld(request,seed);let accepted=false;
  await page.route('**/api/decision',async route=>{
    const input=route.request().postDataJSON() as {npc:NpcState};
    // One accepted idle event, then explicit provider failures. No timing-dependent
    // count of repeated decisions, and no pending work/path continuation claim.
    if(input.npc.id==='yui'){
      if(accepted){await route.fulfill({status:503,json:{error:'e2e-hold-after-one-event'}});return;}
      accepted=true;
    }
    await route.fulfill({json:idle});
  });
  const nextCursor=page.waitForRequest(r=>r.url().endsWith('/api/decision')&&r.postDataJSON()?.npc?.id==='yui'&&r.postDataJSON().npc.randomEventCursor===42,{timeout:20_000});
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect(status(page)).toHaveAttribute('data-persistence-revision',String(revision));
  await startFirstPerson(page);await nextCursor;
  const before=await autosave(page,request);
  for(const value of [before.snapshot,before.stored]){
    expect(value.meta.randomness).toEqual(seed.meta.randomness);
    expect(value.homeNpcs.find(n=>n.id==='yui')).toMatchObject({randomEventCursor:42,money:123,inventory:maker.inventory,currentAction:'idle'});
  }
  const loaded=page.waitForResponse(r=>r.url().endsWith('/api/world/state')&&r.request().method()==='GET'&&r.ok());
  const restoredCursor=page.waitForRequest(r=>r.url().endsWith('/api/decision')&&r.postDataJSON()?.npc?.id==='yui'&&r.postDataJSON().npc.randomEventCursor===42,{timeout:20_000});
  await page.reload({waitUntil:'domcontentloaded'});const received=await (await loaded).json();
  expect(received.snapshot.meta.randomness).toEqual(seed.meta.randomness);expect(received.snapshot.homeNpcs.find((n:NpcState)=>n.id==='yui').randomEventCursor).toBe(42);
  await startFirstPerson(page);await restoredCursor;const after=await autosave(page,request);
  expect(after.stored.meta.randomness).toEqual(seed.meta.randomness);expect(after.stored.homeNpcs.find(n=>n.id==='yui')).toMatchObject({randomEventCursor:42,money:123,inventory:maker.inventory});
  await info.attach('seed-cursor-reload',{body:Buffer.from(JSON.stringify({before:{revision:before.revision,randomness:before.stored.meta.randomness,npc:before.stored.homeNpcs.find(n=>n.id==='yui')},after:{revision:after.revision,randomness:after.stored.meta.randomness,npc:after.stored.homeNpcs.find(n=>n.id==='yui')}})),contentType:'application/json'});
});

test('initial world-load deadline starts a usable world but cannot overwrite its unread save',async({page,request},info)=>{
  test.setTimeout(45_000);const seed=snapshot('unread-seed');seed.meta.day=19;seed.meta.playerPosition={x:48,z:0};
  const revision=await seedWorld(request,seed);const writes:Request[]=[];let getCount=0,release=()=>{},handled=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{handled=resolve;});
  page.on('request',r=>{if(r.url().endsWith('/api/world/state')&&r.method()==='POST')writes.push(r);});
  await page.route('**/api/decision',route=>route.fulfill({json:idle}));
  await page.route('**/api/world/state',async route=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    getCount++;await gate;
    try{await route.fulfill({json:{snapshot:seed,revision}});}
    catch(error){expect(route.request().failure()?.errorText).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED/);}
    finally{handled();}
  });
  const aborted=page.waitForEvent('requestfailed',r=>r.url().endsWith('/api/world/state')&&r.method()==='GET');
  try{
    await page.goto('/',{waitUntil:'domcontentloaded'});await startFirstPerson(page);
    await expect(status(page)).toHaveAttribute('data-persistence-load-blocked','true',{timeout:15_000});
    await expect(status(page)).toHaveAttribute('data-persistence-conflict','false');await expect(page.locator('#log')).toContainText('World state load timed out');
    expect((await aborted).failure()?.errorText).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED/);expect(getCount).toBe(1);
    release();await finished;
    // A native cart push requests the usual debounced save; it must remain local.
    try{await page.keyboard.down('KeyW');await expect(status(page)).toHaveAttribute('data-movable-dirty','true',{timeout:8000});}
    finally{await page.keyboard.up('KeyW');}
    await expect(status(page)).toHaveAttribute('data-persistence-save-pending','false');
    await expect(status(page)).toHaveAttribute('data-persistence-load-blocked','true');
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
    await page.goto('about:blank');expect(writes).toHaveLength(0);const stored=await readWorld(request);
    expect(stored.revision).toBe(revision);expect(stored.snapshot.meta).toEqual(seed.meta);
    await info.attach('load-timeout-storage',{body:Buffer.from(JSON.stringify({getCount,browserWrites:writes.length,stored})),contentType:'application/json'});
  }finally{release();}
});

test('late wildlife intent cannot mutate a rematerialized entity or consume its saved cursor',async({page,request},info)=>{
  test.setTimeout(90_000);
  const chunk:CoarseChunkState={id:'chunk_2_0',cx:2,cz:0,biome:'dryland',settlementLevel:0,population:0,food:0,wood:0,water:0,ecology:0,danger:0,prosperity:0,
    strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0,wildlife:[{species:'rabbit',count:1,carryingCapacity:3,health:100}]};
  const rabbit:WildlifeState={id:'rabbit_rng',chunkId:chunk.id,species:'rabbit',position:{x:44,z:5},ageDays:60,health:100,hunger:0,thirst:0,energy:100,
    sex:'male',generation:0,traits:{speed:1,size:.6,fertility:.8,wariness:.7},currentAction:'rest',lastDecisionAt:0,birthDay:1,randomEventCursor:17};
  const seed=snapshot();seed.meta.playerPosition={x:37,z:1.2};seed.coarseChunks=[chunk];seed.fineChunks=[{chunkId:chunk.id,npcStates:[],objectStates:[],wildlifeStates:[rabbit]}];await seedWorld(request,seed);
  let captured:Request|undefined,release=()=>{},handled=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{handled=resolve;});
  await page.route('**/api/decision',route=>route.fulfill({json:idle}));
  await page.route('**/api/wildlife/decide',async route=>{
    const body=route.request().postDataJSON() as WildlifeDecisionBatchRequest;
    if(captured||!body.requests.some(item=>item.wildlife.id===rabbit.id)){await route.fulfill({status:503,json:{error:'e2e-isolate-late-reply'}});return;}
    captured=route.request();expect(body.requests.find(item=>item.wildlife.id===rabbit.id)!.wildlife.randomEventCursor).toBe(17);
    await gate;
    try{await route.fulfill({json:{source:'e2e-late',decisions:[{wildlifeId:rabbit.id,action:'wander',source:'e2e-late',confidence:1,reasonCode:'old-owner'}]}});}
    finally{handled();}
  });
  try{
    await page.goto('/',{waitUntil:'domcontentloaded'});
    await expect(status(page)).toHaveAttribute('data-assets-ready','true',{timeout:20_000});
    await expect(status(page)).toHaveAttribute('data-asset-failures','0');
    await startFirstPerson(page);await expect(status(page)).toHaveAttribute('data-materialized-chunks','1');
    await expect.poll(()=>Boolean(captured),{timeout:20_000}).toBe(true);
    await nativeCrossing(page,35.2,x=>x<35.7);await expect(status(page)).toHaveAttribute('data-materialized-chunks','0');
    await nativeCrossing(page,37.2,x=>x>36.8);await expect(status(page)).toHaveAttribute('data-materialized-chunks','1');
    await expect.poll(()=>status(page).evaluate(el=>(JSON.parse((el as HTMLElement).dataset.streamedLayouts||'[]') as {fineOwners:string[]}[]).flatMap(unit=>unit.fineOwners))).toEqual([chunk.id]);
    await expect.poll(()=>status(page).evaluate(el=>JSON.parse((el as HTMLElement).dataset.wildlifeVisuals||'[]').some((x:{id:string})=>x.id==='rabbit_rng'))).toBe(true);
    release();await finished;const reply=await captured!.response();expect(reply?.status()).toBe(200);expect(await reply!.finished()).toBeNull();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const saved=await autosave(page,request);const current=saved.stored.fineChunks.find(f=>f.chunkId===chunk.id)!.wildlifeStates!.find(w=>w.id===rabbit.id)!;
    expect(current).toMatchObject({id:rabbit.id,randomEventCursor:17,currentAction:'rest'});
    expect(saved.snapshot.fineChunks.find(f=>f.chunkId===chunk.id)!.wildlifeStates!.find(w=>w.id===rabbit.id)).toMatchObject({randomEventCursor:17,currentAction:'rest'});
    await info.attach('late-wildlife-state',{body:Buffer.from(JSON.stringify({revision:saved.revision,state:current})),contentType:'application/json'});
  }finally{release();}
});
