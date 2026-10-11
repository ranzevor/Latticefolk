import { test, expect, type Page, type TestInfo } from './helpers/native-input-probe.js';
import {setTimeout as wait} from 'node:timers/promises';
import {gzipSync} from 'node:zlib';
import { startFirstPerson } from './helpers/native-start.js';
import { captureLocaleDom, readLocaleDom } from './helpers/locale-dom.js';
import {driveNativeWaypoint} from './helpers/native-waypoint.js';
import type {CoarseChunkState,WorldPersistenceSnapshot} from '../src/types.js';

interface StreamedLayoutView {
  unitId:string;bounds:{minX:number;maxX:number;minZ:number;maxZ:number};fineOwners:string[];
  entities:{id:string;ownerCellId:string;kind:string;visible:boolean;meshes:number;primitiveMeshes:number;position:{x:number;z:number}}[];
}
const layoutViews=(page:Page)=>page.evaluate(()=>JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.streamedLayouts??'[]') as StreamedLayoutView[]);
const numberStatus=async(page:Page,name:string)=>Number(await page.locator('#worldStatus').getAttribute(name));

// Read only presentation and existing diagnostic DOM; never mutate game state.
const readView=(page:Page,includeLayouts=true)=>page.evaluate(includeLayouts=>{
  const shown=(id:string)=>{
    const element=document.getElementById(id);
    if(!element)throw new Error(`Missing HUD element: ${id}`);
    return getComputedStyle(element).display!=='none';
  };
  const status=document.querySelector<HTMLElement>('#worldStatus');
  if(!status)throw new Error('Missing worldStatus');
  return {
    layouts:includeLayouts?JSON.parse(status.dataset.streamedLayouts??'[]') as StreamedLayoutView[]:[],
    discovered:Number(status.getAttribute('data-discovered-chunks')),
    materialized:Number(status.getAttribute('data-materialized-chunks')),
    hud:{diagnostics:['decisionStatus','worldStatus'].map(shown),
    player:['clock','inventory','prompt'].map(shown),
    console:shown('admin'),
    playerLogOnly:document.querySelectorAll('#log > [data-log-audience="developer"]').length===0,
    mode:status.dataset.cameraMode}
  };
},includeLayouts);
const hudView=async(page:Page)=>(await readView(page,false)).hud;

// This observes the existing renderer through CDP; it never publishes a game
// instance or changes its renderer, clock, input, visibility or shadow settings.
async function observeNativeFrames<T>(page:Page,info:TestInfo,action:()=>Promise<T>):Promise<T>{
  const errors:string[]=[];
  const evidence:Record<string,unknown>={profilingPerturbsTiming:true,nativeTraceBufferKiB:8192,
    note:'Native tracing and protocol reads add cost. This is not an unprofiled frame-performance acceptance result.'};
  let session:Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>|undefined;
  let renderers:string|undefined,tracing=false,failed=false,result:T|undefined,originalError:unknown,trace:Buffer|undefined;
  let browserFeatures:Record<string,string>|undefined,backendRenderer:string|undefined;
  const bounded=async<T>(operation:Promise<T>,milliseconds:number):Promise<T>=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Native trace collection deadline exceeded')),milliseconds);})]);}
    finally{if(timer)clearTimeout(timer);}
  };
  const failure=(error:unknown)=>{if(errors.length<8)errors.push((error instanceof Error?error.message:String(error)).slice(0,1024));};
  const read=async()=>{
    const metrics=await session!.send('Performance.getMetrics');
    const environment=await session!.send('Runtime.evaluate',{returnByValue:true,expression:`(() => {
      const canvas=document.querySelector('#game canvas'),gl=canvas?.getContext('webgl2');
      const extension=gl?.getExtension('WEBGL_debug_renderer_info');
      return {wallMs:Date.now(),browserMs:performance.now(),visibility:document.visibilityState,focused:document.hasFocus(),
        inputSeconds:Number(document.querySelector('#worldStatus')?.dataset.playerInputSeconds),
        gpuTimerAvailable:Boolean(gl?.getExtension('EXT_disjoint_timer_query_webgl2')),
        renderer:gl?gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER):null,
        vendor:gl?gl.getParameter(extension?extension.UNMASKED_VENDOR_WEBGL:gl.VENDOR):null};
    })()`});
    let rendererInfo:unknown;
    if(renderers){
      const reply=await session!.send('Runtime.callFunctionOn',{objectId:renderers,returnByValue:true,functionDeclaration:`function(){
        return {rendererCount:this.length,renderers:this.slice(0,4).map(renderer=>({render:{...renderer.info.render},memory:{...renderer.info.memory},
          programs:renderer.info.programs?.length,autoReset:renderer.info.autoReset,
          shadow:{enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,autoUpdate:renderer.shadowMap.autoUpdate}}))};
      }`});
      if(reply.exceptionDetails)failure(reply.exceptionDetails.text);else rendererInfo=reply.result.value;
    }
    if(environment.exceptionDetails)failure(environment.exceptionDetails.text);
    if(typeof environment.result.value?.renderer==='string')backendRenderer=environment.result.value.renderer.slice(0,512);
    return {metrics:metrics.metrics,environment:environment.result.value,rendererInfo};
  };
  const attachBackend=async()=>{
    try{
      const body=Buffer.from(JSON.stringify({renderer:backendRenderer??null,featureStatus:browserFeatures??null,
        errors:errors.map(error=>error.slice(0,128))}));
      if(body.length<=64*1024)await info.attach('streamed-renderer-backend',{body,contentType:'application/json'});
    }catch{}
  };
  try{
    try{
      let browserSession:typeof session;
      let pendingBrowserSession:Promise<NonNullable<typeof session>>|undefined;
      try{
        pendingBrowserSession=page.context().browser()?.newBrowserCDPSession();
        if(!pendingBrowserSession)throw new Error('Browser GPU feature status unavailable');
        browserSession=await bounded(pendingBrowserSession,2000);
        const {gpu}=await bounded(browserSession.send('SystemInfo.getInfo'),2000);
        browserFeatures=Object.fromEntries(['gpu_compositing','webgl','webgl2','rasterization','opengl','vulkan'].map(key=>
          [key,typeof gpu.featureStatus?.[key]==='string'?gpu.featureStatus[key].slice(0,128):'unavailable']));
      }catch(error){failure(error);}
      finally{
        try{if(browserSession)await bounded(browserSession.detach(),2000);}catch(error){failure(error);}
        if(!browserSession)void pendingBrowserSession?.then(late=>late.detach()).catch(()=>{});
      }
      session=await page.context().newCDPSession(page);
      await session.send('Performance.enable',{timeDomain:'timeTicks'});
      // Reuse the exact already-loaded module URL. queryObjects reads its live
      // instances and may cause GC, so it runs before the measured action.
      const prototype=await session.send('Runtime.evaluate',{objectGroup:'streamed-frame-cost',awaitPromise:true,expression:`(async()=>{
        const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(name=>{
          const value=new URL(name);return value.origin===location.origin&&/\\/node_modules\\/\\.vite\\/deps\\/three\\.js$/.test(value.pathname);
        });
        return url?(await import(url)).WebGLRenderer.prototype:null;
      })()`});
      if(prototype.exceptionDetails)failure(prototype.exceptionDetails.text);
      if(prototype.result.objectId){
        const found=await session.send('Runtime.queryObjects',{prototypeObjectId:prototype.result.objectId,objectGroup:'streamed-frame-cost'});
        renderers=found.objects.objectId;
      }else failure('Renderer prototype unavailable from the already-loaded module');
      evidence.before=await read();
      // Playwright retains its own screenshots/snapshots. CDP Tracing does not
      // own that lifecycle, and an already-active native trace is left alone.
      await session.send('Tracing.start',{transferMode:'ReturnAsStream',streamFormat:'json',streamCompression:'none',
        traceConfig:{recordMode:'recordContinuously',traceBufferSizeInKb:8192,enableSampling:false,
          includedCategories:['devtools','gpu.capture','viz','gpu']}});tracing=true;
    }catch(error){failure(error);}
    evidence.actionStartWallMs=Date.now();
    try{result=await action();}catch(error){failed=true;originalError=error;}
    finally{evidence.actionEndWallMs=Date.now();}
  }finally{
    if(session){
      try{
        if(tracing){
          let stream:string|undefined;
          let completed!:(value:{dataLossOccurred:boolean;stream?:string})=>void;
          const completion=new Promise<{dataLossOccurred:boolean;stream?:string}>(resolve=>{completed=resolve;});
          const onComplete=(value:{dataLossOccurred:boolean;stream?:string})=>{stream=value.stream;completed(value);};
          try{
            let listening=false,listenerError:unknown;
            try{session.on('Tracing.tracingComplete',onComplete);listening=true;}catch(error){listenerError=error;}
            const endRequest=session.send('Tracing.end');
            if(!listening){await bounded(endRequest,5000);throw listenerError;}
            const [,end]=await bounded(Promise.all([endRequest,completion]),5000);
            evidence.traceDataLoss=end.dataLossOccurred;
            if(!stream)throw new Error('Native trace completed without a stream');
            const chunks:Buffer[]=[];let bytes=0,eof=false;
            const deadline=Date.now()+8000;
            while(!eof){
              if(chunks.length>=64)throw new Error('Native trace stream exceeds 64 reads');
              const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Native trace stream deadline exceeded');
              const part=await bounded(session.send('IO.read',{handle:stream,size:256*1024}),remaining);
              const chunk=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');bytes+=chunk.length;
              evidence.traceReadBytes=bytes;
              if(bytes>8*1024*1024){evidence.traceTruncated=true;throw new Error('Native trace stream exceeds 8MiB');}
              if(!chunk.length&&!part.eof)throw new Error('Native trace stream made no progress');
              chunks.push(chunk);eof=part.eof;
            }
            trace=Buffer.concat(chunks);
            const data=JSON.parse(trace.toString('utf8')) as {traceEvents?:{name?:string;cat?:string;ph?:string;dur?:number;pid?:number;tid?:number}[]};
            const costs=new Map<string,{name:string;cat:string;pid?:number;tid?:number;count:number;durationUs:number}>();
            for(const event of data.traceEvents??[]){
              if(event.ph!=='X'||!Number.isFinite(event.dur))continue;
              const name=String(event.name??'').slice(0,160),cat=String(event.cat??'').slice(0,160),key=JSON.stringify([event.pid,event.tid,name,cat]);
              const cost=costs.get(key)??{name,cat,pid:event.pid,tid:event.tid,count:0,durationUs:0};
              cost.count++;cost.durationUs+=event.dur!;costs.set(key,cost);
            }
            evidence.traceEventCount=data.traceEvents?.length??0;
            evidence.longestCompleteEvents=[...costs.values()].sort((a,b)=>b.durationUs-a.durationUs).slice(0,40);
            evidence.eventDurationNote='Complete X events only; nested and concurrent durations overlap and cannot be summed as frame time.';
          }catch(error){evidence.traceTruncated=true;trace=undefined;failure(error);}
          finally{
            try{session.off('Tracing.tracingComplete',onComplete);}catch(error){failure(error);}
            if(stream){try{await bounded(session.send('IO.close',{handle:stream}),2000);}catch(error){failure(error);}}
          }
        }
        try{evidence.after=await read();}catch(error){failure(error);}
      }finally{
        const cleanup=await Promise.allSettled([
          Promise.resolve().then(()=>session!.send('Performance.disable')),
          Promise.resolve().then(()=>session!.send('Runtime.releaseObjectGroup',{objectGroup:'streamed-frame-cost'}))]);
        for(const item of cleanup)if(item.status==='rejected')failure(item.reason);
        try{await session.detach();}catch(error){failure(error);}
      }
    }
  }
  if(failed){
    evidence.errors=errors;
    let compressed:Buffer|undefined;
    try{if(trace)compressed=gzipSync(trace);}catch(error){failure(error);}
    evidence.traceBytes=compressed?.length??0;evidence.traceOmitted=Boolean(tracing&&(!compressed||compressed.length>256*1024));
    // Evidence failure must never replace the original movement/assertion error.
    try{
      let body:Buffer|undefined,reason:string|undefined,originalSummaryBytes:number|undefined;
      try{
        body=Buffer.from(JSON.stringify(evidence,null,2));originalSummaryBytes=body.length;
        if(body.length>64*1024){body=undefined;reason='summary_exceeds_64KiB';}
      }catch(error){failure(error);reason='summary_serialization_failed';}
      body??=Buffer.from(JSON.stringify({summaryOmitted:true,reason,originalSummaryBytes,
        profilingPerturbsTiming:true,nativeTraceBufferKiB:8192,actionStartWallMs:evidence.actionStartWallMs,
        actionEndWallMs:evidence.actionEndWallMs,traceBytes:evidence.traceBytes,traceOmitted:evidence.traceOmitted,
        traceTruncated:evidence.traceTruncated,traceDataLoss:evidence.traceDataLoss,errors}));
      await info.attach('streamed-frame-costs',{body,contentType:'application/json'});
    }catch{}
    if(compressed&&compressed.length<=256*1024){
      try{await info.attach('streamed-native-trace',{body:compressed,contentType:'application/gzip'});}catch{}
    }
    await attachBackend();throw originalError;
  }
  await attachBackend();
  return result as T;
}

test('72m streamed layouts use sourced assets and God camera does not discover or materialize chunks',async({page},info)=>{
  test.setTimeout(180_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-asset-failures','0',{timeout:45_000});
  let ready:Awaited<ReturnType<typeof readView>>|undefined;
  await expect.poll(async()=>{
    ready=await readView(page);
    return ready.layouts.length>0&&ready.layouts.every(layout=>layout.entities.every(entity=>entity.meshes>0));
  },{timeout:45_000}).toBe(true);
  const before=ready!.layouts;
  expect(before.length).toBe(8);
  expect(before.every(layout=>layout.bounds.maxX-layout.bounds.minX===72&&layout.bounds.maxZ-layout.bounds.minZ===72)).toBe(true);
  const entities=before.flatMap(layout=>layout.entities);
  expect(new Set(entities.map(entity=>entity.id)).size).toBe(entities.length);
  expect(entities.filter(entity=>entity.kind!=='road').every(entity=>entity.primitiveMeshes===0)).toBe(true);
  expect(entities.some(entity=>entity.kind==='building')).toBe(true);
  expect(entities.some(entity=>['tree','bush','rock','flower'].includes(entity.kind))).toBe(true);
  await startFirstPerson(page);
  await expect.poll(()=>hudView(page)).toEqual({diagnostics:[false,false],player:[true,true,true],console:false,playerLogOnly:true,mode:'firstPerson'});
  await info.attach('first-person-clean-hud',{body:await page.screenshot(),contentType:'image/png'});
  // Tab reveals the same live diagnostics without changing camera or world state.
  await page.keyboard.press('Tab');
  await expect.poll(()=>hudView(page)).toMatchObject({diagnostics:[true,true],player:[true,true,true],console:true,mode:'firstPerson'});
  await page.keyboard.press('Tab');
  let settled:Awaited<ReturnType<typeof readView>>|undefined;
  await expect.poll(async()=>{settled=await readView(page);return settled.hud;}).toEqual({diagnostics:[false,false],player:[true,true,true],console:false,playerLogOnly:true,mode:'firstPerson'});
  const {discovered,materialized}=settled!;

  await page.keyboard.press('KeyG');
  await expect(page.locator('#worldStatus')).toHaveAttribute('data-camera-mode','god');
  await expect.poll(()=>hudView(page)).toMatchObject({diagnostics:[true,true],player:[true,true,true],console:false,mode:'god'});
  // Refresh observer labels in place without returning the player to the world.
  const observerReference=await page.evaluateHandle(captureLocaleDom,-1);
  await page.locator('#localeSelect').selectOption('ja');
  await expect.poll(()=>page.evaluate(readLocaleDom,observerReference)).toMatchObject({
    lang:'ja',modeHint:'観察者',mode:'god',playerBody:'false',sameCanvas:true,discovered,materialized
  });
  await info.attach('god-view-language-ja',{body:await page.screenshot(),contentType:'image/png'});
  await expect.poll(()=>page.evaluate(readLocaleDom,observerReference)).toMatchObject({mode:'god',playerBody:'false'});
  await page.locator('#localeSelect').selectOption('en');
  await expect.poll(()=>page.evaluate(readLocaleDom,observerReference)).toMatchObject({
    lang:'en',modeHint:'Observer',mode:'god',playerBody:'false',sameCanvas:true,discovered,materialized
  });
  await observerReference.dispose();
  const canvas=page.locator('#game canvas');
  const box=await canvas.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
  for(let i=0;i<5;i++){await page.mouse.wheel(0,900);await wait(100);}
  await wait(700);
  await info.attach('streamed-sourced-layouts-god',{body:await page.screenshot(),contentType:'image/png'});

  const afterView=await readView(page);
  expect(afterView.discovered).toBe(discovered);
  expect(afterView.materialized).toBe(materialized);
  const after=afterView.layouts;
  expect(after).toEqual(before);
  await page.keyboard.press('KeyG');
  await expect.poll(()=>hudView(page)).toEqual({diagnostics:[false,false],player:[true,true,true],console:false,playerLogOnly:true,mode:'firstPerson'});
  expect(errors).toEqual([]);
});


test('ordinary walking crosses the home edge into the visible layout and preserves it through return and reload',async({page,request},info)=>{
  test.setTimeout(180_000);
  const reset=await request.delete('/api/world/state');expect(reset.ok()).toBe(true);
  const {revision}=await reset.json();
  const cells:CoarseChunkState[]=[];
  for(let cz=-1;cz<=1;cz++)for(let cx=2;cx<=4;cx++)cells.push({id:`chunk_${cx}_${cz}`,cx,cz,biome:'plains',settlementLevel:2,population:0,
    food:65,wood:50,water:60,ecology:55,danger:10,prosperity:65,strategy:'trade_route',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0,wildlife:[]});
  const snapshot:WorldPersistenceSnapshot={version:1,meta:{day:1,minuteOfDay:495,weather:'clear',weatherEpoch:1,playerPosition:{x:34,z:0},
    playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}},coarseChunks:cells,fineChunks:[],homeNpcs:[],homeObjects:[]};
  const seed=await request.post('/api/world/state',{data:{snapshot,expectedRevision:revision}});expect(seed.ok()).toBe(true);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
    await page.goto('/',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#worldStatus')).toHaveAttribute('data-asset-failures','0',{timeout:45_000});
    await expect.poll(async()=>{const unit=(await layoutViews(page)).find(x=>x.unitId==='unit_1_0');return Boolean(unit?.entities.every(x=>x.meshes>0));},{timeout:45_000}).toBe(true);
    const before=(await layoutViews(page)).find(x=>x.unitId==='unit_1_0')!;
    expect(before.bounds).toEqual({minX:36,maxX:108,minZ:-36,maxZ:36});expect(before.fineOwners).toEqual([]);
    await startFirstPerson(page);
    const enter=await observeNativeFrames(page,info,async()=>{
      const reached=await page.evaluate(driveNativeWaypoint,{target:{x:40,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});expect(reached.reached).toBe(true);return reached;
    });
    const entered=(await layoutViews(page)).find(x=>x.unitId==='unit_1_0')!;
    expect(entered.entities).toEqual(before.entities);expect(entered.fineOwners).toEqual(['chunk_2_0']);
    expect(await numberStatus(page,'data-player-grounding-error')).toBeLessThan(.001);
    await info.attach('streamed-layout-entered',{body:await page.screenshot(),contentType:'image/png'});
    const leave=await page.evaluate(driveNativeWaypoint,{target:{x:34,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});expect(leave.reached).toBe(true);
    expect((await layoutViews(page)).find(x=>x.unitId==='unit_1_0')).toEqual(before);
    await expect.poll(async()=>{const response=await request.get('/api/world/state');const data=await response.json();return data.snapshot?.streamedLayouts?.some((layout:any)=>layout.unit.id==='unit_1_0')===true;},{timeout:45_000}).toBe(true);
    const persisted=await (await request.get('/api/world/state')).json();
    const savedLayout=persisted.snapshot.streamedLayouts.find((layout:any)=>layout.unit.id==='unit_1_0');
    expect(savedLayout.unit.bounds).toEqual(before.bounds);
    expect([...savedLayout.buildings,...savedLayout.roads,...savedLayout.objects].map(x=>x.id).sort()).toEqual(before.entities.map(x=>x.id).sort());
    await page.reload();await expect.poll(async()=>{const unit=(await layoutViews(page)).find(x=>x.unitId==='unit_1_0');return unit?.entities.every(x=>x.meshes>0)===true;},{timeout:45_000}).toBe(true);
    expect((await layoutViews(page)).find(x=>x.unitId==='unit_1_0')!.entities).toEqual(before.entities);
    const reloaded=await (await request.get('/api/world/state')).json();
    expect(reloaded.snapshot.streamedLayouts.find((layout:any)=>layout.unit.id==='unit_1_0')).toEqual(savedLayout);
    await info.attach('streamed-layout-saved-and-reloaded',{body:Buffer.from(JSON.stringify({before,entered,enter,leave,savedLayout},null,2)),contentType:'application/json'});
    expect(errors).toEqual([]);
  }finally{await page.close();const clear=await request.delete('/api/world/state');expect(clear.ok()).toBe(true);}
});
