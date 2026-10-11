import {test,expect,type APIRequestContext,type Page,type Request,type Route} from '@playwright/test';
import type {WorldPersistenceSnapshot} from '../src/types.js';
import {startFirstPerson} from './helpers/native-start.js';

interface SavedWorld {revision:number;snapshot:WorldPersistenceSnapshot;}
async function savedWorld(request:APIRequestContext):Promise<SavedWorld>{
  const response=await request.get('/api/world/state');expect(response.ok()).toBe(true);
  return response.json();
}
function expectSettledRain(saved:SavedWorld){
  expect(saved.snapshot.meta.day).toBe(4);
  expect(saved.snapshot.meta.weather).toBe('rain');
  expect(saved.snapshot.meta.weatherEpoch).toBe(2);
  expect(saved.snapshot.meta.minuteOfDay).toBeGreaterThanOrEqual(720);
  expect(saved.snapshot.meta.minuteOfDay).toBeLessThan(1080);
}
async function nextBrowserAutosave(page:Page,request:APIRequestContext,start:()=>Promise<void>){
  const url=new URL('/api/world/state',page.url()).href;
  let selected:Request|undefined,release!:()=>void,resolveRequest!:(value:Request)=>void;
  let rejectRequest!:(error:Error)=>void;
  const checkpoint=new Promise<void>(resolve=>{release=resolve;});
  const captured=new Promise<Request>((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});
  const route=async(intercepted:Route)=>{
    const candidate=intercepted.request();
    if(candidate.method()==='POST'&&candidate.resourceType()==='fetch'&&candidate.frame()===page.mainFrame()){
      if(!selected){selected=candidate;resolveRequest(candidate);}
      else await checkpoint;
    }
    await intercepted.continue();
  };
  await page.route(url,route);
  const timer=setTimeout(()=>rejectRequest(new Error('No browser autosave issued at checkpoint')),45_000);
  try{
    const [saved]=await Promise.all([(async()=>{
      const outgoing=await captured;
      clearTimeout(timer);
  const submitted=outgoing.postDataJSON() as {expectedRevision:number;snapshot:WorldPersistenceSnapshot};
  expect(Number.isSafeInteger(submitted.expectedRevision)).toBe(true);
  expectSettledRain({revision:submitted.expectedRevision,snapshot:submitted.snapshot});
  const response=await outgoing.response();expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);expect(await response!.finished()).toBeNull();
  const acknowledged=await response!.json() as {revision:number};
  expect(acknowledged.revision).toBe(submitted.expectedRevision+1);
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-persistence-revision',String(acknowledged.revision));
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-persistence-conflict','false');
  const stored=await savedWorld(request);expectSettledRain(stored);
  expect(stored.revision).toBeGreaterThanOrEqual(acknowledged.revision);
  return {revision:acknowledged.revision,snapshot:submitted.snapshot,storedRevision:stored.revision};
    })(),start()]);
    return saved;
  }finally{
    clearTimeout(timer);release();await page.unroute(url,route);
  }
}

// The existing isolated E2E SQLite world is shared by one worker. Close before
// clearing it so this page's final beacon cannot seed the following scenario.
test.afterEach(async({page,request})=>{
  await page.close();const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);
});

test('settled saved weather and its processed phase survive real page reload and autosave',async({page,request},info)=>{
  // No time-skipping interaction occurs; even 120 seconds at full simulation
  // speed remains inside the seeded six-hour block.
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);
  const seed:WorldPersistenceSnapshot={version:1,
    meta:{day:4,minuteOfDay:720,weather:'rain',weatherEpoch:2,playerPosition:{x:0,z:7},
      playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}},
    coarseChunks:[],fineChunks:[],homeNpcs:[],homeObjects:[]};
  const written=await request.post('/api/world/state',{data:{expectedRevision:(await reset.json()).revision,snapshot:seed}});
  expect(written.ok()).toBe(true);const seedRevision=(await written.json() as {revision:number}).revision;

  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const status=page.locator('#worldStatus'),clock=page.locator('#clock');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(async()=>Number(await status.getAttribute('data-persistence-revision'))).toBeGreaterThanOrEqual(seedRevision);
  await expect(status).toHaveAttribute('data-persistence-conflict','false');
  // Require an ordinary acknowledged client autosave, rather than rereading
  // the initial fixture. The original client drops weatherEpoch from this save.
  const beforeReload=await nextBrowserAutosave(page,request,async()=>{
    await startFirstPerson(page);await expect(clock).toContainText(/ · Rain$/);
  });expect(beforeReload.revision).toBeGreaterThan(seedRevision);
  await expect(clock).toContainText(/ · Rain$/);

  const restoredResponse=page.waitForResponse(response=>response.url().endsWith('/api/world/state')&&response.request().method()==='GET'&&response.ok());
  await page.reload({waitUntil:'domcontentloaded'});
  const restored=await (await restoredResponse).json() as SavedWorld;expectSettledRain(restored);
  await expect.poll(async()=>Number(await status.getAttribute('data-persistence-revision'))).toBeGreaterThanOrEqual(restored.revision);
  await expect(status).toHaveAttribute('data-persistence-conflict','false');
  // The reload and its state GET have finished before this observer is armed.
  // Frame identity alone is not a document boundary because the main frame is reused.
  const afterReload=await nextBrowserAutosave(page,request,async()=>{
    await startFirstPerson(page);await expect(clock).toContainText(/ · Rain$/);
  });expect(afterReload.revision).toBeGreaterThan(restored.revision);
  expect(afterReload.snapshot.meta.minuteOfDay).toBeGreaterThanOrEqual(restored.snapshot.meta.minuteOfDay);
  await expect(clock).toContainText(/ · Rain$/);
  await expect(status).toHaveAttribute('data-persistence-conflict','false');
  expect(errors).toEqual([]);
  await info.attach('weather-save-reload-state',{body:Buffer.from(JSON.stringify({seedRevision,beforeReload:{revision:beforeReload.revision,meta:beforeReload.snapshot.meta},restored:{revision:restored.revision,meta:restored.snapshot.meta},afterReload:{revision:afterReload.revision,meta:afterReload.snapshot.meta}},null,2)),contentType:'application/json'});
  await info.attach('settled-weather-after-reload',{body:await page.screenshot(),contentType:'image/png'});
});
