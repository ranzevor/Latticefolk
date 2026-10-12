import { test, expect, type Page, type APIRequestContext } from './helpers/native-input-probe.js';
import type { CoarseChunkState, DecisionResponse, NpcState, WorldObjectState, WorldPersistenceSnapshot } from '../src/types.js';
import { fineParcelFixture } from './helpers/parcel-fixture.js';
import { ensureWildlifePopulations } from '../src/world/ecology.js';
import { startFirstPerson } from './helpers/native-start.js';
import { lookForObject } from './helpers/relative-look.js';
import { traverseNativeParcelRoute } from './helpers/parcel-route.js';

interface ParcelView {
  id: string; chunkId: string | null; item: string; count: number;
  position: { x: number; z: number }; visible: boolean; renderedChildren: number;
}
interface SavedWorld { revision: number; snapshot: WorldPersistenceSnapshot; }
async function saved(request: APIRequestContext): Promise<SavedWorld> {
  const response = await request.get('/api/world/state');
  expect(response.ok()).toBe(true);
  return response.json();
}
async function view(page: Page) {
  return page.evaluate(() => {
    const data = document.querySelector<HTMLElement>('#worldStatus')!.dataset;
    const portable = JSON.parse(data.portableObjects ?? '{"parcels":[]}') as { pendingFullSave: boolean; parcels: ParcelView[] };
    return { ...portable, parcels: portable.parcels as ParcelView[],
      player: { x: Number(data.playerX), z: Number(data.playerZ) },
      revision: Number(data.persistenceRevision), conflict: data.persistenceConflict,
      materialized: Number(data.materializedChunks), mode: data.cameraMode,
      discovered: Number(data.discoveredChunks) };
  });
}
async function seed(request: APIRequestContext, snapshot: WorldPersistenceSnapshot) {
  const reset = await request.delete('/api/world/state'); expect(reset.ok()).toBe(true);
  const response = await request.post('/api/world/state', {
    data: { expectedRevision: (await reset.json()).revision, snapshot }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).revision as number;
}
const emptyInventory = () => ({apple:0,bread:0,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0});
const idle: DecisionResponse = {source:'test-bounded-idle',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'parcel-idle'};
const fine: CoarseChunkState = {id:'chunk_2_0',cx:2,cz:0,biome:'plains',settlementLevel:0,population:6,
  food:50,wood:50,water:50,ecology:50,danger:0,prosperity:10,
  strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0};
// Mirror restoreKnownChunks before deriving the fixture: seeded plants change the
// number of natural objects (and thus the resident's deterministic RNG position).
// Keep the original donor-relative offsets and native route, not an arbitrary move.
ensureWildlifePopulations(fine);

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await startFirstPerson(page);
  await page.waitForFunction(() => {
    const data = document.querySelector<HTMLElement>('#worldStatus')?.dataset;
    return data?.portableObjects && Number(data.persistenceRevision) > 0;
  }, undefined, {timeout:45_000});
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-asset-failures','0');
}
async function waitForParcel(page: Page, id?: string) {
  await page.waitForFunction(id => {
    const raw = document.querySelector<HTMLElement>('#worldStatus')?.dataset.portableObjects;
    if (!raw) return false;
    return JSON.parse(raw).parcels.some((p: ParcelView) => (!id || p.id === id) && p.visible && p.renderedChildren > 0);
  }, id, {timeout:45_000});
  return (await view(page)).parcels.find(p => !id || p.id === id)!;
}
async function collect(page: Page, title: string, yaw = 0, pitch = .82) {
  await lookForObject(page, title, yaw, pitch);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#interactionTitle')).toHaveText(title);
  await expect(page.locator('#interactionActions button')).toHaveCount(2);
  await page.locator('#interactionActions button').nth(1).press('Enter');
}
test.afterEach(async ({page,request}) => {
  await page.close();
  const reset = await request.delete('/api/world/state'); expect(reset.ok()).toBe(true);
});

test('home NPC drop has a visible sourced parcel, preserves zero Z on reload and never respawns after pickup', async ({page,request}, info) => {
  test.setTimeout(240_000);
  const donor: NpcState = {id:'ren',name:'莲',role:'baker',position:{x:10,z:-1.8},home:{x:-12,z:-17},workAt:'oven',
    mood:'neutral',hunger:20,energy:80,social:65,money:10,inventory:[{kind:'bread',count:2}],
    relationships:{},memories:[],currentAction:'idle',goal:'drop one parcel',lastDecisionAt:0};
  const revision = await seed(request, {version:1,
    meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:{x:10.7,z:0},playerInventory:emptyInventory()},
    coarseChunks:[],fineChunks:[],homeNpcs:[donor],homeObjects:[]});
  let enabled = false, proposed = false;
  await page.route('**/api/decision', async route => {
    const input = route.request().postDataJSON();
    if (enabled && !proposed && input.npc.id === donor.id) {
      expect(input.allowedActions).toContain('drop_item'); proposed = true;
      await route.fulfill({json:{...idle,action:'drop_item',reasonCode:'parcel-home-drop'} satisfies DecisionResponse});
    } else await route.fulfill({json:idle});
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect((await view(page)).player).toEqual({x:10.7,z:0});
  enabled = true;
  const drop = await waitForParcel(page);
  expect(proposed).toBe(true); expect(drop.chunkId).toBe(null);
  expect(drop.count).toBe(1); expect(drop.item).toBe('bread');
  expect(drop.position.x).toBeCloseTo(10.7,8); expect(drop.position.z).toBeCloseTo(-1.4,8);
  await expect.poll(async () => {
    const s = await saved(request);
    return s.revision > revision && s.snapshot.homeObjects.some(o => o.id === drop.id);
  }, {timeout:45_000}).toBe(true);
  const beforePickup = await saved(request);
  const source = beforePickup.snapshot.homeNpcs.find(n => n.id === donor.id)!;
  const object = beforePickup.snapshot.homeObjects.find(o => o.id === drop.id)!;
  expect(source.inventory.find(i => i.kind === 'bread')?.count).toBe(1);
  expect(object.resourceAmount).toBe(1); expect(object.respawnAt).toBeUndefined();
  expect(object.name).toContain('Parcel'); expect(object.name).toContain('×1');
  await lookForObject(page, object.name, 0, .82);
  await info.attach('home-sourced-parcel-before-pickup', {body:await page.screenshot(),contentType:'image/png'});
  await page.reload(); await startFirstPerson(page);
  const restored = await waitForParcel(page, drop.id);
  expect(restored.position).toEqual(drop.position); expect((await view(page)).player).toEqual({x:10.7,z:0});
  await collect(page, object.name);
  await expect.poll(async () => {
    const s = await saved(request);
    return s.snapshot.meta.playerInventory.bread === 1 && !s.snapshot.homeObjects.some(o => o.id === drop.id);
  }, {timeout:45_000}).toBe(true);
  // Exercise the old 45-second respawn window using real elapsed time, not a clock override.
  await page.waitForTimeout(46_000);
  expect((await view(page)).parcels.some(p => p.id === drop.id)).toBe(false);
  await page.reload(); await startFirstPerson(page);
  const after = await saved(request);
  expect(after.snapshot.meta.playerPosition).toEqual({x:10.7,z:0});
  expect(after.snapshot.meta.playerInventory.bread).toBe(1);
  expect(after.snapshot.homeNpcs.find(n => n.id === donor.id)!.inventory.find(i => i.kind === 'bread')?.count).toBe(1);
  expect(after.snapshot.homeObjects.some(o => o.id === drop.id)).toBe(false);
  await info.attach('home-parcel-consumption-reload', {body:await page.screenshot(),contentType:'image/png'});
  await info.attach('home-parcel-conserved-save', {body:Buffer.from(JSON.stringify({drop,beforePickup,after},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('fine NPC parcel belongs to its source chunk and survives native unload/revisit before one-shot pickup', async ({page,request}, info) => {
  test.setTimeout(360_000);
  const fixture = await fineParcelFixture(fine);
  const {donor,start,exitX} = fixture;
  await info.attach('fine-parcel-source-route-preconditions', {body:Buffer.from(JSON.stringify(fixture,null,2)),contentType:'application/json'});
  await seed(request, {version:1,meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:start,playerInventory:emptyInventory()},
    coarseChunks:fixture.coarseChunks,fineChunks:[],homeNpcs:[],homeObjects:[]});
  let proposed = false;
  await page.route('**/api/decision', async route => {
    const input = route.request().postDataJSON();
    if (!proposed && input.npc.id === donor.id) {
      expect(input.npc.position).toEqual({x:donor.x,z:donor.z});
      expect(input.allowedActions).toContain('drop_item'); proposed = true;
      await route.fulfill({json:{...idle,action:'drop_item',reasonCode:'parcel-fine-drop'} satisfies DecisionResponse});
    } else await route.fulfill({json:idle});
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const drop = await waitForParcel(page);
  expect(proposed).toBe(true); expect(drop.chunkId).toBe(fine.id); expect(drop.item).toBe('water');
  await expect.poll(async () => {
    const s = await saved(request);
    return s.snapshot.fineChunks.find(c => c.chunkId === fine.id)?.objectStates.some(o => o.id === drop.id) ?? false;
  }, {timeout:45_000}).toBe(true);
  const created = await saved(request);
  const chunk = created.snapshot.fineChunks.find(c => c.chunkId === fine.id)!;
  const object = chunk.objectStates.find(o => o.id === drop.id)!;
  expect(created.snapshot.homeObjects.some(o => o.id === drop.id)).toBe(false);
  expect(chunk.npcStates.find(n => n.id === donor.id)!.inventory.find(i => i.kind === 'water')?.count).toBe(0);
  await lookForObject(page, object.name, 0, .82);
  await info.attach('fine-sourced-parcel-before-crossing', {body:await page.screenshot(),contentType:'image/png'});
  const outbound=await page.evaluate(traverseNativeParcelRoute,{key:'KeyA' as const,targetX:exitX,laneZ:start.z});
  await expect.poll(async () => (await view(page)).materialized).toBe(0);
  expect((await view(page)).parcels.some(p => p.id === drop.id)).toBe(false);
  const inbound=await page.evaluate(traverseNativeParcelRoute,{key:'KeyD' as const,targetX:start.x,laneZ:start.z});
  await info.attach('fine-parcel-native-detour-input',{body:Buffer.from(JSON.stringify({outbound,inbound},null,2)),contentType:'application/json'});
  const returned = await waitForParcel(page,drop.id);
  expect(returned.position).toEqual(drop.position); expect(returned.count).toBe(1);
  expect(returned.chunkId).toBe(fine.id);
  const origin = (await view(page)).player;
  expect(Math.abs(origin.z-start.z)).toBeLessThan(.02);
  const dx = drop.position.x-origin.x, dz = drop.position.z-origin.z;
  const yaw = Math.atan2(dx,-dz), distance = Math.hypot(dx,dz);
  expect(distance).toBeLessThan(2.3);
  await lookForObject(page,object.name,yaw,Math.atan2(1.5,distance));
  await info.attach('fine-parcel-native-revisit', {body:await page.screenshot(),contentType:'image/png'});
  await collect(page,object.name,0,Math.atan2(1.5,distance));
  await expect.poll(async () => {
    const s = await saved(request);
    return s.snapshot.meta.playerInventory.water === 1 && !s.snapshot.fineChunks.find(c => c.chunkId === fine.id)?.objectStates.some(o => o.id === drop.id);
  }, {timeout:45_000}).toBe(true);
  await page.reload(); await startFirstPerson(page);
  const after = await saved(request);
  expect(after.snapshot.meta.playerInventory.water).toBe(1);
  expect(after.snapshot.fineChunks.find(c => c.chunkId === fine.id)!.objectStates.some(o => o.id === drop.id)).toBe(false);
  expect(after.snapshot.homeObjects.some(o => o.id === drop.id)).toBe(false);
  expect(after.snapshot.fineChunks.find(c => c.chunkId === fine.id)!.npcStates.find(n => n.id === donor.id)!.inventory.find(i => i.kind === 'water')?.count).toBe(0);
  await info.attach('fine-parcel-native-roundtrip-save', {body:Buffer.from(JSON.stringify({drop,returned,origin,created,after},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('unacknowledged fine pickup cannot save a reward-only final beacon', async ({page,request}, info) => {
  test.setTimeout(240_000);
  const object: WorldObjectState = {id:'persisted_fine_parcel',chunkId:fine.id,kind:'dropped_item',name:'Bread parcel',
    position:{x:48,z:-1.1},tags:['dropped','bread'],usable:false,pickupable:true,item:'bread',resourceAmount:3};
  await seed(request, {version:1,meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:{x:48,z:0},playerInventory:emptyInventory()},
    coarseChunks:[{...fine,population:0}],fineChunks:[{chunkId:fine.id,npcStates:[],objectStates:[object],wildlifeStates:[]}],homeNpcs:[],homeObjects:[]});
  await page.route('**/api/decision', route => route.fulfill({json:idle}));
  await open(page); await waitForParcel(page,object.id);
  const baseline = await saved(request);
  let held = false, release: (() => void) | undefined;
  let captured: WorldPersistenceSnapshot | undefined;
  let compactWhilePending = 0;
  const heldReady = new Promise<void>(resolve => {
    void page.route('**/api/world/state', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const envelope = route.request().postDataJSON() as {snapshot:WorldPersistenceSnapshot};
      const snapshot = envelope.snapshot;
      if (held && snapshot.fineChunks.length === 0) compactWhilePending++;
      if (!held && snapshot.meta.playerInventory.bread === 3 && snapshot.fineChunks.some(c => c.chunkId === fine.id)) {
        held = true; captured = snapshot; resolve();
        await new Promise<void>(done => { release = done; });
        await route.abort('aborted').catch(() => {}); // Teardown of the deliberately held full write.
      } else await route.continue();
    });
  });
  try {
    const title = (await saved(request)).snapshot.fineChunks.find(c => c.chunkId === fine.id)!.objectStates.find(o => o.id === object.id)!.name;
    // The restored label is localized; it is also visible in the ordinary object prompt.
    await lookForObject(page,'Parcel',0,.94);
    await info.attach('fine-parcel-before-held-save', {body:await page.screenshot(),contentType:'image/png'});
    await page.keyboard.press('KeyE');
    await expect(page.locator('#interactionTitle')).toContainText('Parcel');
    await page.locator('#interactionActions button').nth(1).press('Enter');
    await heldReady;
    expect(captured!.meta.playerInventory.bread).toBe(3);
    expect(captured!.fineChunks.find(c => c.chunkId === fine.id)!.objectStates.some(o => o.id === object.id)).toBe(false);
    expect((await view(page)).pendingFullSave).toBe(true);
    await page.goto('about:blank');
    release?.(); await page.unroute('**/api/world/state');
    const durable = await saved(request);
    expect(compactWhilePending).toBe(0);
    expect(durable.snapshot.meta.playerInventory.bread).toBe(0);
    expect(durable.snapshot.fineChunks.find(c => c.chunkId === fine.id)!.objectStates.find(o => o.id === object.id)!.resourceAmount).toBe(3);
    await open(page); await waitForParcel(page,object.id);
    await lookForObject(page,'Parcel',0,.94);
    await page.keyboard.press('KeyE'); await page.locator('#interactionActions button').nth(1).press('Enter');
    await expect.poll(async () => {
      const s = await saved(request);
      return s.snapshot.meta.playerInventory.bread === 3 && !s.snapshot.fineChunks.find(c => c.chunkId === fine.id)?.objectStates.some(o => o.id === object.id);
    }, {timeout:45_000}).toBe(true);
    const acknowledged = await saved(request);
    await info.attach('fine-parcel-full-save-atomicity', {body:Buffer.from(JSON.stringify({title,baseline,durable,acknowledged,compactWhilePending},null,2)),contentType:'application/json'});
  } finally { release?.(); }
});


test('bounded fine NPC pickup reclaims a dropped parcel once and remains consumed after reload', async ({page,request}, info) => {
  test.setTimeout(240_000);
  const {donor,start,coarseChunks} = await fineParcelFixture(fine);
  await seed(request,{version:1,meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:start,playerInventory:emptyInventory()},
    coarseChunks,fineChunks:[],homeNpcs:[],homeObjects:[]});
  let dropped=false, pickupEnabled=false, picked=false;
  let targetId: string | undefined;
  const proposals: unknown[]=[];
  await page.route('**/api/decision',async route=>{
    const input=route.request().postDataJSON();
    let response=idle;
    if(input.npc.id===donor.id && !dropped){
      expect(input.allowedActions).toContain('drop_item');dropped=true;
      response={...idle,action:'drop_item',reasonCode:'npc-parcel-drop'};
    } else if(input.npc.id===donor.id && pickupEnabled && !picked){
      expect(input.allowedActions).toContain('pickup');
      expect(input.world.nearbyObjects.some((o: WorldObjectState)=>o.id===targetId && o.pickupable)).toBe(true);
      picked=true;response={...idle,action:'pickup',targetObjectId:targetId,reasonCode:'npc-parcel-pickup'};
    }
    if(input.npc.id===donor.id)proposals.push({npc:input.npc,allowedActions:input.allowedActions,response});
    await route.fulfill({json:response});
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);
  const drop=await waitForParcel(page);targetId=drop.id;
  expect(drop.chunkId).toBe(fine.id);expect(drop.count).toBe(1);expect(drop.item).toBe('water');
  await expect.poll(async()=>{
    const c=(await saved(request)).snapshot.fineChunks.find(c=>c.chunkId===fine.id);
    return c?.objectStates.some(o=>o.id===drop.id) && c.npcStates.find(n=>n.id===donor.id)?.inventory.find(i=>i.kind==='water')?.count===0;
  },{timeout:45_000}).toBe(true);
  const before=await saved(request);
  await lookForObject(page,'Parcel',0,.82);
  await info.attach('npc-parcel-visible-before-pickup',{body:await page.screenshot(),contentType:'image/png'});
  pickupEnabled=true;
  await expect.poll(async()=>{
    const c=(await saved(request)).snapshot.fineChunks.find(c=>c.chunkId===fine.id);
    return picked && c?.npcStates.find(n=>n.id===donor.id)?.inventory.find(i=>i.kind==='water')?.count===1
      && !c.objectStates.some(o=>o.id===drop.id);
  },{timeout:45_000}).toBe(true);
  expect((await view(page)).parcels.some(p=>p.id===drop.id)).toBe(false);
  await page.waitForTimeout(46_000);
  expect((await view(page)).parcels.some(p=>p.id===drop.id)).toBe(false);
  await page.reload();await startFirstPerson(page);
  await page.waitForFunction(()=>Number(document.querySelector<HTMLElement>('#worldStatus')?.dataset.materializedChunks)>0,undefined,{timeout:45_000});
  const after=await saved(request), chunk=after.snapshot.fineChunks.find(c=>c.chunkId===fine.id)!;
  expect(chunk.npcStates.find(n=>n.id===donor.id)!.inventory.find(i=>i.kind==='water')?.count).toBe(1);
  expect(chunk.objectStates.some(o=>o.id===drop.id)).toBe(false);
  expect(after.snapshot.homeObjects.some(o=>o.id===drop.id)).toBe(false);
  expect(after.snapshot.meta.playerInventory).toEqual(emptyInventory());
  expect((await view(page)).parcels.some(p=>p.id===drop.id)).toBe(false);
  await info.attach('npc-parcel-consumed-reload',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('npc-parcel-pickup-conservation',{body:Buffer.from(JSON.stringify({drop,before,after,proposals},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});

