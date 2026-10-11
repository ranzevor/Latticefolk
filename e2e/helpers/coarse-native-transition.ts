export async function crossCoarseBoundary() {
  const world=document.querySelector<HTMLElement>('#worldStatus');
  const probe=(window as unknown as {nativeInputProbe?:{start:(route:unknown)=>void;pulse:(request:{codes:string[];durationMs:number;deadlineEpochMs:number})=>Promise<unknown>;finish:()=>Promise<void>}}).nativeInputProbe;
  if(!world||!probe)throw new Error('Coarse transition requires native input and world diagnostics');
  const before={coarseRequestTimeouts:Number(world.dataset.coarseRequestTimeouts),coarseDecidedChunks:Number(world.dataset.coarseDecidedChunks),coarseLastBatchSize:Number(world.dataset.coarseLastBatchSize)};
  const startedAt=performance.now(),materialized=()=>Number(world.dataset.materializedChunks);
  const leg=async(code:string,predicate:()=>boolean)=>{
    const deadline=performance.now()+2500;
    const release=await probe.pulse({codes:['ShiftLeft',code],durationMs:200,deadlineEpochMs:performance.timeOrigin+deadline}) as {releasedEventAt?:number}|undefined;
    if(performance.now()>=deadline)return false;
    const consumedRelease=()=>{
      const raw=world.dataset.simulationConsumedThrough,consumed=raw?.trim()?Number(raw):NaN;
      return typeof release?.releasedEventAt==='number'&&Number.isFinite(release.releasedEventAt)&&release.releasedEventAt>=0&&Number.isFinite(consumed)&&consumed>=release.releasedEventAt;
    };
    const initialClock=JSON.parse(world.dataset.simulationClock??'null') as {pendingSeconds:number}|null;
    if(consumedRelease()&&initialClock?.pendingSeconds===0)return predicate();
    return new Promise<boolean>((resolve,reject)=>{
      const releasedAt=performance.now();let refreshed=false,frame=0,settled=false;
      const observer=new MutationObserver(()=>{refreshed=true;});observer.observe(world,{attributes:true,attributeFilter:['data-simulation-clock']});
      const finish=(value:boolean,error?:Error)=>{if(settled)return;settled=true;observer.disconnect();clearTimeout(timer);cancelAnimationFrame(frame);error?reject(error):resolve(value);};
      const timer=setTimeout(()=>finish(false),deadline-performance.now());
      const sample=(at:number)=>{
        try{
          const clock=JSON.parse(world.dataset.simulationClock??'null') as {pendingSeconds:number}|null;
          if(!clock||!Number.isFinite(clock.pendingSeconds)||clock.pendingSeconds<0)throw new Error('Coarse transition clock is unavailable');
          if(performance.now()>=deadline){finish(false);return;}
          if((release?.releasedEventAt!==undefined?consumedRelease():(refreshed&&at>=releasedAt))&&clock.pendingSeconds===0){finish(predicate());return;}
          refreshed=false;frame=requestAnimationFrame(sample);
        }catch(error){finish(false,error as Error);}
      };
      try{frame=requestAnimationFrame(sample);}catch(error){finish(false,error as Error);}
    });
  };
  probe.start({kind:'coarse-materialize-unload',legTimeoutMs:2500,pulseMs:200});
  try{
    const entered=await leg('KeyD',()=>materialized()>0);
    const exited=entered&&await leg('KeyA',()=>materialized()===0);
    if(exited)await (window as unknown as {notifyCoarseTransitionExited:()=>Promise<void>}).notifyCoarseTransitionExited();
    return {before,entered,exited,materialized:materialized(),startedAt,finishedAt:performance.now()};
  }finally{await probe.finish();}
}
