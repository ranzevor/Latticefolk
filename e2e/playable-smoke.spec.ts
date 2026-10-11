import { test, expect, type APIRequestContext, type Page } from './helpers/native-input-probe.js';
import type { WorldPersistenceSnapshot } from '../src/types.js';
import { startFirstPerson } from './helpers/native-start.js';
import { driveNativeWaypoint } from './helpers/native-waypoint.js';


interface ChunkDecisionRequestForE2E {
  chunks:Array<{id:string}>;
}

interface RuntimeSnapshot {
  cameraMode:string;
  discoveredChunks:number;
  materializedChunks:number;
  coarseDecidedChunks:number;
  coarseLastSource:string;
  coarseLastBatchSize:number;
  coarseRequestTimeouts:number;
  physicsBodies:number;
  terrainSurfaces:number;
  playerX:number;
  playerZ:number;
  playerGroundingError:number;
  npcGroundingMaxError:number;
  wildlifeGroundingMaxError:number;
  buildingVisualTargets:number;
  buildingVisualMinHeight:number;
  buildingVisualMaxBoundsError:number;
  wellVisualWidth:number;
  wellVisualHeight:number;
  wellVisualDepth:number;
  semanticLicensedTargets:number;
  semanticLicensedResolved:number;
  semanticPrimitiveMeshes:number;
  movableBodies:number;
  cartX:number;
  cartZ:number;
  cartVisualChildren:number;
  movableDirty:boolean;
  persistenceSavePending:boolean;
  persistenceRevision:number;
  persistenceConflict:boolean;
  assetFailures:number;
  licensedVisualTargets:number;
  licensedVisualsResolved:number;
}

async function runtime(page:Page):Promise<RuntimeSnapshot> {
  return page.evaluate(()=>{
    const el=document.querySelector<HTMLElement>('#worldStatus');
    if(!el)throw new Error('worldStatus runtime observability node is missing');
    const data=el.dataset;
    const read=(key:string)=>Number(data[key]??'NaN');
    return {
      cameraMode:data.cameraMode??'',
      discoveredChunks:read('discoveredChunks'),
      materializedChunks:read('materializedChunks'),
      coarseDecidedChunks:read('coarseDecidedChunks'),
      coarseLastSource:data.coarseLastSource??'',
      coarseLastBatchSize:read('coarseLastBatchSize'),
      coarseRequestTimeouts:read('coarseRequestTimeouts'),
      physicsBodies:read('physicsBodies'),
      terrainSurfaces:read('terrainSurfaces'),
      playerX:read('playerX'),
      playerZ:read('playerZ'),
      playerGroundingError:read('playerGroundingError'),
      npcGroundingMaxError:read('npcGroundingMaxError'),
      wildlifeGroundingMaxError:read('wildlifeGroundingMaxError'),
      buildingVisualTargets:read('buildingVisualTargets'),
      buildingVisualMinHeight:read('buildingVisualMinHeight'),
      buildingVisualMaxBoundsError:read('buildingVisualMaxBoundsError'),
      wellVisualWidth:read('wellVisualWidth'),
      wellVisualHeight:read('wellVisualHeight'),
      wellVisualDepth:read('wellVisualDepth'),
      semanticLicensedTargets:read('semanticLicensedTargets'),
      semanticLicensedResolved:read('semanticLicensedResolved'),
      semanticPrimitiveMeshes:read('semanticPrimitiveMeshes'),
      movableBodies:read('movableBodies'),
      cartX:read('cartX'),
      cartZ:read('cartZ'),
      cartVisualChildren:read('cartVisualChildren'),
      movableDirty:data.movableDirty==='true',
      persistenceSavePending:data.persistenceSavePending==='true',
      persistenceRevision:read('persistenceRevision'),
      persistenceConflict:data.persistenceConflict==='true',
      assetFailures:read('assetFailures'),
      licensedVisualTargets:read('licensedVisualTargets'),
      licensedVisualsResolved:read('licensedVisualsResolved')
    };
  });
}

async function moveWithKeys(page:Page,keys:string[],durationMs:number) {
  try{
    for(const key of keys)await page.keyboard.down(key);
    await page.waitForTimeout(durationMs);
  }finally{
    for(const key of [...keys].reverse())await page.keyboard.up(key);
  }
  await page.waitForTimeout(120);
}

async function moveUntil(
  page:Page,
  keys:string[],
  reached:(state:RuntimeSnapshot)=>boolean,
  timeoutMs=10_000
) {
  for(const key of keys)await page.keyboard.down(key);
  let last:RuntimeSnapshot|undefined;
  const deadline=Date.now()+timeoutMs;
  try{
    while(true){
      last=await runtime(page);
      if(reached(last))break;
      if(Date.now()>=deadline){
        // page.evaluate can finish after the nominal deadline on software WebGL runners.
        // Accept the final authoritative sample if movement reached the waypoint meanwhile.
        last=await runtime(page);
        if(reached(last))break;
        throw new Error(`movement waypoint timed out after ${timeoutMs}ms at (${last.playerX.toFixed(3)}, ${last.playerZ.toFixed(3)})`);
      }
      await page.waitForTimeout(120);
    }
  }finally{
    for(const key of [...keys].reverse())await page.keyboard.up(key);
  }
  await page.waitForTimeout(120);
}

async function drivePlayerTo(
  page:Page,
  target:{x:number;z:number},
  timeoutMs=20_000,
  tolerance=.35
) {
  const result=await page.evaluate(driveNativeWaypoint,{target,timeoutMs,tolerance});
  expect(
    result.reached,
    `player failed to reach (${target.x}, ${target.z}); stopped at (${result.x.toFixed(3)}, ${result.z.toFixed(3)})`
  ).toBe(true);
  return result;
}

async function persistedCartZ(page:Page):Promise<number> {
  return page.evaluate(async()=>{
    const response=await fetch('/api/world/state',{cache:'no-store'});
    if(!response.ok)return Number.NaN;
    const data=await response.json() as {snapshot?:{homeObjects?:Array<{id?:string;position?:{z?:number}}>}|null};
    const cart=data.snapshot?.homeObjects?.find(object=>object.id==='cart_town');
    return Number(cart?.position?.z??Number.NaN);
  });
}

async function serverPersistence(request:APIRequestContext){
  const response=await request.get('/api/world/state',{failOnStatusCode:false});
  if(!response.ok())throw new Error(`world-state GET failed: HTTP ${response.status()}`);
  return response.json() as Promise<{
    revision:number;
    snapshot?:WorldPersistenceSnapshot|null;
  }>;
}

async function worldStatusNumber(page:Page,attribute:string){
  const value=await page.locator('#worldStatus').getAttribute(attribute);
  return Number(value??Number.NaN);
}

test('real playable scene keeps God View observer-only and uses authoritative ground', async ({ page }, testInfo) => {
  // Software-rendered Chromium can spend most of the default 60s budget loading the real 3D asset set on hosted runners.
  // Keep assertions individually bounded while allowing the full playable path enough wall-clock time to finish.
  test.setTimeout(420_000);
  const pageErrors:string[]=[];
  page.on('pageerror',(error)=>pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async()=>(await runtime(page)).terrainSurfaces,{timeout:15_000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await runtime(page)).cartVisualChildren,{timeout:15_000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await runtime(page)).assetFailures,{timeout:15_000}).toBe(0);
  await expect.poll(async()=>{const state=await runtime(page);return state.licensedVisualTargets>0&&state.licensedVisualsResolved===state.licensedVisualTargets;},{timeout:15_000}).toBe(true);

  const home=await runtime(page);
  expect(home.movableBodies).toBeGreaterThanOrEqual(1);
  expect(home.materializedChunks).toBe(0);
  expect(home.terrainSurfaces).toBeGreaterThanOrEqual(1);
  expect(home.playerGroundingError).toBeLessThan(.02);
  expect(home.npcGroundingMaxError).toBeLessThan(.02);
  expect(home.buildingVisualTargets).toBeGreaterThanOrEqual(12);
  expect(home.buildingVisualMinHeight).toBeGreaterThanOrEqual(5.0);
  expect(home.buildingVisualMaxBoundsError).toBeLessThan(.03);
  expect(home.wellVisualWidth).toBeGreaterThan(1.2);
  expect(home.wellVisualWidth).toBeLessThan(1.5);
  expect(home.wellVisualDepth).toBeGreaterThan(1.8);
  expect(home.wellVisualDepth).toBeLessThanOrEqual(2.05);
  expect(home.wellVisualHeight).toBeGreaterThan(2.3);
  expect(home.wellVisualHeight).toBeLessThanOrEqual(2.65);
  expect(home.semanticLicensedTargets).toBe(8);
  expect(home.semanticLicensedResolved).toBe(home.semanticLicensedTargets);
  expect(home.semanticPrimitiveMeshes).toBe(0);

  await startFirstPerson(page);
  await expect(page.locator('#startOverlay')).toHaveClass(/hidden/);
  await expect.poll(async()=>page.evaluate(()=>document.pointerLockElement?.tagName??''),{timeout:10_000}).toBe('CANVAS');

  let injectedSaveFailure=false;
  let releaseSaveRetry=()=>{};
  const saveRetryGate=new Promise<void>(resolve=>{releaseSaveRetry=resolve;});
  await page.route('**/api/world/state',async route=>{
    if(route.request().method()!=='POST'){
      await route.continue();
      return;
    }
    if(!injectedSaveFailure){
      injectedSaveFailure=true;
      await route.fulfill({status:503,contentType:'application/json',body:'{"error":"e2e-injected-save-failure"}'});
      return;
    }
    await saveRetryGate;
    await route.continue();
  });

  const firstBefore=await runtime(page);
  expect(firstBefore.cameraMode).toBe('firstPerson');
  // Wait for a real physics-resolved push, not a fixed wall-clock pulse. The
  // direction-sensitive scenario starts with native keyboard activation so an
  // absolute mouse-positioning event cannot be mistaken for relative look input.
  await moveUntil(page,['ShiftLeft','KeyW'],state=>state.cartZ<firstBefore.cartZ-.20,10_000);
  const firstAfter=await runtime(page);
  expect(Math.abs(firstAfter.playerX-firstBefore.playerX)).toBeLessThan(.1);
  expect(Math.hypot(firstAfter.playerX-firstBefore.playerX,firstAfter.playerZ-firstBefore.playerZ)).toBeGreaterThan(.25);
  expect(firstAfter.terrainSurfaces).toBeGreaterThanOrEqual(1);
  expect(firstAfter.cartZ).toBeLessThan(firstBefore.cartZ-.08);
  expect(firstAfter.movableBodies).toBe(home.movableBodies);

  const pushedCartZ=firstAfter.cartZ;
  await moveWithKeys(page,['KeyS'],650);

  await expect.poll(()=>injectedSaveFailure,{timeout:8_000}).toBe(true);
  // A clean player HUD must still surface a real failed autosave.
  await expect(page.locator('#log')).toBeVisible();
  await expect(page.locator('#log')).toContainText('World autosave failed: HTTP 503');
  await expect.poll(async()=>(await runtime(page)).movableDirty,{timeout:8_000}).toBe(true);
  releaseSaveRetry();

  await expect(page.locator('#worldStatus')).toBeHidden();

  await page.screenshot({path:testInfo.outputPath('first-person-cart-pushed.png'),fullPage:true});
  await expect.poll(async()=>Math.abs((await persistedCartZ(page))-pushedCartZ),{timeout:45_000}).toBeLessThan(.08);
  await expect.poll(async()=>{const state=await runtime(page);return !state.persistenceSavePending&&!state.movableDirty;},{timeout:30_000}).toBe(true);
  await testInfo.attach('cart-push-and-save.json',{
    contentType:'application/json',
    body:Buffer.from(JSON.stringify({before:firstBefore,after:firstAfter,persistedCartZ:await persistedCartZ(page)},null,2))
  });

  await page.unroute('**/api/world/state');
  await page.reload();
  await expect.poll(async()=>(await runtime(page)).terrainSurfaces,{timeout:15_000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await runtime(page)).cartVisualChildren,{timeout:15_000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await runtime(page)).assetFailures,{timeout:15_000}).toBe(0);
  await expect.poll(async()=>{const state=await runtime(page);return state.licensedVisualTargets>0&&state.licensedVisualsResolved===state.licensedVisualTargets;},{timeout:15_000}).toBe(true);
  await expect.poll(async()=>Math.abs((await runtime(page)).cartZ-pushedCartZ),{timeout:8_000}).toBeLessThan(.08);
  const restoredGrounding=await runtime(page);
  expect(restoredGrounding.playerGroundingError).toBeLessThan(.02);
  expect(restoredGrounding.npcGroundingMaxError).toBeLessThan(.02);
  expect(restoredGrounding.semanticLicensedResolved).toBe(restoredGrounding.semanticLicensedTargets);
  expect(restoredGrounding.semanticPrimitiveMeshes).toBe(0);
  await startFirstPerson(page);
  await expect.poll(async()=>page.evaluate(()=>document.pointerLockElement?.tagName??''),{timeout:10_000}).toBe('CANVAS');

  await page.keyboard.press('KeyG');
  await expect.poll(async()=>(await runtime(page)).cameraMode).toBe('god');
  const worldStatusBox=await page.locator('#worldStatus').boundingBox();
  expect(worldStatusBox).not.toBeNull();
  expect(worldStatusBox!.width).toBeLessThanOrEqual(541);
  const godBefore=await runtime(page);
  expect(godBefore.physicsBodies).toBe(firstAfter.physicsBodies-1);
  expect(godBefore.terrainSurfaces).toBe(firstAfter.terrainSurfaces);

  await moveWithKeys(page,['KeyW'],500);
  const godAfter=await runtime(page);
  expect(godAfter.discoveredChunks).toBe(godBefore.discoveredChunks);
  expect(godAfter.materializedChunks).toBe(godBefore.materializedChunks);
  expect(godAfter.playerX).toBe(godBefore.playerX);
  expect(godAfter.playerZ).toBe(godBefore.playerZ);
  expect(godAfter.physicsBodies).toBe(godBefore.physicsBodies);
  expect(godAfter.terrainSurfaces).toBe(godBefore.terrainSurfaces);

  await page.screenshot({path:testInfo.outputPath('god-view.png'),fullPage:true});

  await page.keyboard.press('KeyG');
  await expect.poll(async()=>(await runtime(page)).cameraMode).toBe('firstPerson');
  await expect.poll(async()=>page.evaluate(()=>document.pointerLockElement?.tagName??''),{timeout:10_000}).toBe('CANVAS');
  const firstRestored=await runtime(page);
  expect(firstRestored.physicsBodies).toBe(godAfter.physicsBodies+1);

  // Real first-person tool interaction. Use normal first-person input against the same
  // authoritative static/dynamic collision, but keep the steering loop inside the page.
  // Hosted software WebGL can make each Playwright protocol round-trip take seconds; the
  // previous per-pulse protocol loop turned a few seconds of gameplay into several minutes.
  // Real trace showed this waypoint needs more wall-clock budget on software WebGL runners: ~0.6s simulation movement is not enough for the remaining distance.
  await drivePlayerTo(page,{x:5.2,z:4.0},45_000,.55);
  // Trace evidence: the second waypoint continued advancing under normal simulation but required more wall-clock budget on hosted software WebGL runners.
  await drivePlayerTo(page,{x:13.95,z:3.4},45_000,.45);
  const treeApproach=await drivePlayerTo(page,{x:13.95,z:2.35},12_000,.28);
  expect(treeApproach.x).toBeGreaterThan(13.55);
  expect(treeApproach.x).toBeLessThan(14.4);
  expect(treeApproach.z).toBeLessThan(2.65);
  expect(treeApproach.z).toBeGreaterThan(2.0);
  await expect(page.locator('#prompt')).toContainText('苹果树',{timeout:10_000});
  await page.keyboard.press('KeyE');
  await expect(page.locator('#interactionMenu')).not.toHaveClass(/hidden/);
  await expect(page.locator('#interactionTitle')).toContainText('苹果树');
  const treeActions=page.locator('#interactionActions button');
  await expect(treeActions).toHaveCount(3);
  await treeActions.nth(2).click();
  await expect(page.locator('#toast')).toContainText('木料 ×2');
  await page.screenshot({path:testInfo.outputPath('first-person-tool-contact.png'),fullPage:true});

  expect(pageErrors).toEqual([]);
});


test('revision CAS rejects a delayed stale browser writer and stale final beacon', async ({ page, request }) => {
  test.setTimeout(240_000);

  const reset=await request.delete('/api/world/state',{failOnStatusCode:false});
  expect(reset.ok()).toBe(true);
  const resetBody=await reset.json() as {revision:number};
  const baseRevision=resetBody.revision;
  expect(Number.isSafeInteger(baseRevision)).toBe(true);

  let releaseDelayed=()=>{};
  const delayedGate=new Promise<void>(resolve=>{releaseDelayed=resolve;});
  let delayedCaptured=false;
  let delayedExpectedRevision=Number.NaN;
  let delayedSnapshot:WorldPersistenceSnapshot|undefined;

  try{
    await page.goto('/');
    const worldStatus=page.locator('#worldStatus');
    await expect(worldStatus).toHaveAttribute('data-persistence-revision',String(baseRevision),{timeout:30_000});
    await expect(worldStatus).toHaveAttribute('data-persistence-conflict','false',{timeout:30_000});
    await expect.poll(()=>worldStatusNumber(page,'data-movable-bodies'),{timeout:30_000}).toBeGreaterThanOrEqual(1);

    // Establish one real browser save first so the server has a complete authoritative snapshot
    // and this tab's local revision is synchronized before we deliberately make its next write stale.
    await startFirstPerson(page);
    await expect.poll(async()=>page.evaluate(()=>document.pointerLockElement?.tagName??''),{timeout:10_000}).toBe('CANVAS');
    await moveWithKeys(page,['ShiftLeft','KeyW'],650);
    await expect.poll(async()=>{
      const local=await worldStatusNumber(page,'data-persistence-revision');
      const stored=await serverPersistence(request);
      return local>baseRevision&&local===stored.revision&&Boolean(stored.snapshot);
    },{timeout:30_000}).toBe(true);
    const synchronizedRevision=await worldStatusNumber(page,'data-persistence-revision');

    await page.route('**/api/world/state',async route=>{
      if(route.request().method()==='POST'&&!delayedCaptured){
        delayedCaptured=true;
        const body=JSON.parse(route.request().postData()||'{}') as {expectedRevision?:number;snapshot?:WorldPersistenceSnapshot};
        delayedExpectedRevision=Number(body.expectedRevision);
        delayedSnapshot=body.snapshot?structuredClone(body.snapshot):undefined;
        await delayedGate;
        try{
          await route.continue();
        }catch(error){
          if(!page.isClosed())throw error;
        }
        return;
      }
      await route.continue();
    });

    // Push the cart again: this uses the game's normal movable-object save scheduling and gives
    // us one in-flight browser write to hold while another authority advances the CAS revision.
    await moveWithKeys(page,['ShiftLeft','KeyW'],650);
    await expect.poll(()=>delayedCaptured,{timeout:20_000}).toBe(true);
    // Autosave may advance between the earlier synchronization and interception.
    // While this request is held, the exact CAS token must agree with BOTH live authorities.
    expect(delayedExpectedRevision).toBeGreaterThanOrEqual(synchronizedRevision);
    expect(delayedExpectedRevision).toBe(await worldStatusNumber(page,'data-persistence-revision'));
    const staleRevision=delayedExpectedRevision;

    const beforeAuthority=await serverPersistence(request);
    expect(beforeAuthority.revision).toBe(staleRevision);
    // The delayed browser POST may be the first save after reset, so the server snapshot can
    // legitimately still be null. Use the captured real browser payload as the authoritative
    // candidate, then let a competing CAS write win before releasing that stale browser request.
    expect(delayedSnapshot).toBeTruthy();
    const authoritativeSnapshot=structuredClone(delayedSnapshot!);
    authoritativeSnapshot.meta.minuteOfDay=(authoritativeSnapshot.meta.minuteOfDay+1)%1440;
    const authorityWrite=await request.post('/api/world/state',{
      data:{expectedRevision:staleRevision,snapshot:authoritativeSnapshot},
      failOnStatusCode:false
    });
    expect(authorityWrite.ok()).toBe(true);
    const authorityBody=await authorityWrite.json() as {revision:number};
    expect(authorityBody.revision).toBeGreaterThan(staleRevision);

    releaseDelayed();
    await expect(worldStatus).toHaveAttribute('data-persistence-conflict','true',{timeout:30_000});
    await expect(worldStatus).toHaveAttribute('data-persistence-save-pending','false',{timeout:30_000});
    expect(await worldStatusNumber(page,'data-persistence-revision')).toBe(staleRevision);

    const afterConflict=await serverPersistence(request);
    expect(afterConflict.revision).toBe(authorityBody.revision);
    expect(afterConflict.snapshot?.meta.minuteOfDay).toBe(authoritativeSnapshot.meta.minuteOfDay);

    await page.reload();
    await expect.poll(()=>worldStatusNumber(page,'data-persistence-revision'),{timeout:30_000}).toBeGreaterThanOrEqual(authorityBody.revision);
    await expect(worldStatus).toHaveAttribute('data-persistence-conflict','false',{timeout:30_000});
    await expect(worldStatus).toHaveAttribute('data-persistence-save-pending','false',{timeout:30_000});
    await expect.poll(async()=>{
      const localRevision=await worldStatusNumber(page,'data-persistence-revision');
      return localRevision===(await serverPersistence(request)).revision;
    },{timeout:30_000}).toBe(true);

    const beforeFinalSave=(await serverPersistence(request)).revision;
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
    await expect.poll(async()=>(await serverPersistence(request)).revision,{timeout:10_000}).toBeGreaterThan(beforeFinalSave);
    const afterFinalSave=(await serverPersistence(request)).revision;
    expect(await worldStatusNumber(page,'data-persistence-revision')).toBeLessThan(afterFinalSave);

    await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
    await page.waitForTimeout(1_000);
    expect((await serverPersistence(request)).revision).toBe(afterFinalSave);
  }finally{
    // Do not unroute a still-held request: Playwright may auto-continue it during unroute,
    // making the resumed handler call continue() a second time.
    releaseDelayed();
  }
});


test('coarse policy reply crossing a real materialize-unload transition is discarded and retry recovers', async ({ page, request }, testInfo) => {
  test.setTimeout(420_000);

  const reset=await request.delete('/api/world/state',{failOnStatusCode:false});
  expect(reset.ok()).toBe(true);
  const resetBody=await reset.json() as {revision:number};

  // Start from a legal persisted position just inside the authored-home boundary. The
  // materialize/unload crossing itself still uses ordinary first-person input and the same
  // authoritative physics; unrelated stochastic town traffic is not part of this lifecycle gate.
  const boundarySeed:WorldPersistenceSnapshot={
    version:1,
    meta:{
      day:1,minuteOfDay:8*60+15,weather:'clear',playerPosition:{x:35.1,z:1.2},
      playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}
    },
    coarseChunks:[],fineChunks:[],homeNpcs:[],homeObjects:[]
  };
  const seeded=await request.post('/api/world/state',{
    data:{expectedRevision:resetBody.revision,snapshot:boundarySeed},
    failOnStatusCode:false
  });
  expect(seeded.ok()).toBe(true);

  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async()=>(await runtime(page)).assetFailures,{timeout:30_000}).toBe(0);
  await startFirstPerson(page);
  await expect.poll(async()=>page.evaluate(()=>document.pointerLockElement?.tagName??''),{timeout:10_000}).toBe('CANVAS');

  await expect.poll(async()=>(await runtime(page)).coarseDecidedChunks,{timeout:20_000}).toBeGreaterThan(0);
  const staged=await runtime(page);
  expect(staged.playerX).toBeGreaterThan(34.7);
  expect(staged.playerX).toBeLessThan(35.7);
  expect(staged.materializedChunks).toBe(0);

  let heldRequest:ChunkDecisionRequestForE2E|undefined;
  let releasedAt=0;
  let released=false;
  let releaseHeld=()=>{};
  const releaseOnce=()=>{
    if(released)return;
    released=true;
    releasedAt=Date.now();
    releaseHeld();
  };
  const heldGate=new Promise<void>(resolve=>{releaseHeld=resolve;});
  let heldCompleted=false;
  let releaseFresh=()=>{};
  const freshGate=new Promise<void>(resolve=>{releaseFresh=resolve;});
  let freshResponses=0;
  await page.exposeFunction('notifyCoarseStaleObserved',()=>{releaseFresh();});
  await page.exposeFunction('notifyCoarseTransitionExited',()=>{
    releaseOnce();
  });
  let notifyCaptured=()=>{};
  const captured=new Promise<void>(resolve=>{notifyCaptured=resolve;});
  let capturedAt=0;
  await page.route('**/api/world/chunks/decide',async route=>{
    if(heldRequest){
      await freshGate;
      await route.continue().catch(()=>{});
      freshResponses++;
      return;
    }
    heldRequest=JSON.parse(route.request().postData()||'{}') as ChunkDecisionRequestForE2E;
    capturedAt=Date.now();notifyCaptured();
    await heldGate;
    const payload={
      source:'e2e-stale-transition',
      decisions:heldRequest.chunks.map(chunk=>({
        chunkId:chunk.id,
        strategy:'fortify',
        migrationPolicy:'retain',
        ecologyPolicy:'protect',
        confidence:.9,
        reasonCode:'e2e_stale_transition',
        source:'e2e-stale-transition'
      }))
    };
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
    heldCompleted=true;
  });

  try{
    // A settled coarse world may legally choose the production 30s cadence.
    // Wait beyond that cadence instead of treating a healthy quiet period as a missing request.
    let captureTimer:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([captured,new Promise<never>((_,reject)=>{captureTimer=setTimeout(()=>reject(new Error('No coarse request within 45000 ms')),45_000);})]);
    } finally {clearTimeout(captureTimer);}
    const transition=await page.evaluate(async()=>{
      const status=()=>document.querySelector<HTMLElement>('#worldStatus');
      const data=status()!.dataset;
      const before={coarseRequestTimeouts:Number(data.coarseRequestTimeouts),coarseDecidedChunks:Number(data.coarseDecidedChunks),coarseLastBatchSize:Number(data.coarseLastBatchSize)};
      const startedAt=performance.now();
      const materialized=()=>Number(status()?.dataset.materializedChunks??'NaN');
      const key=(type:'keydown'|'keyup',code:string)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
      const until=async(predicate:()=>boolean,timeoutMs:number)=>{
        const deadline=performance.now()+timeoutMs;
        while(!predicate()){
          if(performance.now()>=deadline)return false;
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        }
        return true;
      };
      try {
        key('keydown','ShiftLeft');key('keydown','KeyD');
        const entered=await until(()=>materialized()>0,2_500);
        key('keyup','KeyD');key('keydown','KeyA');
        const exited=entered&&await until(()=>materialized()===0,2_500);
        if(exited){
          const notify=(window as unknown as Window & {
            notifyCoarseTransitionExited:()=>Promise<void>;
          }).notifyCoarseTransitionExited;
          await notify();
        }
        return {before,entered,exited,materialized:materialized(),startedAt,finishedAt:performance.now()};
      } finally {key('keyup','KeyD');key('keyup','KeyA');key('keyup','ShiftLeft');}
    });
    releaseOnce(); // Browser transition completion releases the held response immediately; finally remains the safety net.
    const before=transition.before;
    await testInfo.attach('coarse-native-transition-timing',{body:Buffer.from(JSON.stringify({capturedAt,releasedAt,transition},null,2)),contentType:'application/json'});
    expect(transition.entered).toBe(true);
    expect(transition.exited).toBe(true);
    expect(transition.materialized).toBe(0);

    releaseOnce();
    await expect.poll(()=>heldCompleted,{timeout:3_000}).toBe(true);
    const afterStale=await page.evaluate(async()=>{
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      const data=document.querySelector<HTMLElement>('#worldStatus')!.dataset;
      const snapshot={coarseRequestTimeouts:Number(data.coarseRequestTimeouts),coarseDecidedChunks:Number(data.coarseDecidedChunks),
        coarseLastBatchSize:Number(data.coarseLastBatchSize),coarseLastSource:data.coarseLastSource};
      await (window as unknown as {notifyCoarseStaleObserved:()=>Promise<void>}).notifyCoarseStaleObserved();
      return snapshot;
    });
    expect(afterStale.coarseRequestTimeouts).toBe(before.coarseRequestTimeouts);
    expect(afterStale.coarseDecidedChunks).toBe(before.coarseDecidedChunks);
    expect(afterStale.coarseLastBatchSize).toBe(before.coarseLastBatchSize);
    expect(afterStale.coarseLastSource).not.toBe('e2e-stale-transition');
    await page.screenshot({path:testInfo.outputPath('coarse-request-transition-rejected.png'),fullPage:true});

    releaseFresh();
    await expect.poll(async()=>(await runtime(page)).coarseDecidedChunks,{timeout:40_000}).toBeGreaterThan(before.coarseDecidedChunks);
    const recovered=await runtime(page);
    expect(recovered.coarseLastBatchSize).toBeGreaterThan(0);
    expect(freshResponses).toBeGreaterThan(0);
    expect(recovered.coarseLastSource).not.toBe('e2e-stale-transition');
  }finally{
    releaseOnce();releaseFresh();
    await page.unroute('**/api/world/chunks/decide').catch(()=>{});
  }
});

