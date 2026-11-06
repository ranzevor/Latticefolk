export async function crossCoarseBoundary() {
  const world=document.querySelector<HTMLElement>('#worldStatus');
  const probe=(window as unknown as {nativeInputProbe?:{start:(route:unknown)=>void;pulse:(request:{codes:string[];durationMs:number;deadlineEpochMs:number})=>Promise<unknown>;finish:()=>Promise<void>}}).nativeInputProbe;
  if(!world||!probe)throw new Error('Coarse transition requires native input and world diagnostics');
  const before={coarseRequestTimeouts:Number(world.dataset.coarseRequestTimeouts),coarseDecidedChunks:Number(world.dataset.coarseDecidedChunks),coarseLastBatchSize:Number(world.dataset.coarseLastBatchSize)};
  const startedAt=performance.now(),materialized=()=>Number(world.dataset.materializedChunks);
  const leg=async(code:string,predicate:()=>boolean)=>{
    const deadline=performance.now()+2500,codes=['ShiftLeft',code];
    let fresh=false,settled=false,pulseReturned=false,observer:MutationObserver|undefined,timer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined;
    let listeningDown=false,listeningUp=false,release:{releasedEventAt?:number}|undefined;
    const pressed=new Set<string>(),released=new Map<string,number>();
    let complete!:(result:{value:boolean;error?:unknown})=>void;
    const observation=new Promise<{value:boolean;error?:unknown}>(resolve=>{complete=resolve;});
    const finish=(value:boolean,error?:unknown)=>{
      if(settled)return;settled=true;observer?.disconnect();
      if(listeningDown)removeEventListener('keydown',input,true);if(listeningUp)removeEventListener('keyup',input,true);
      if(timer!==undefined)clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);
      complete({value,error});
    };
    const releasedAt=()=>codes.every(key=>released.has(key))?Math.max(...released.values()):undefined;
    const state=()=>{
      const clock=JSON.parse(world.dataset.simulationClock??'null') as {pendingSeconds:number;pendingInputChanges:number}|null;
      if(!clock||!Number.isFinite(clock.pendingSeconds)||clock.pendingSeconds<0||!Number.isInteger(clock.pendingInputChanges)||clock.pendingInputChanges<0)throw new Error('Coarse transition clock is unavailable');
      const raw=world.dataset.simulationConsumedThrough,consumed=raw?.trim()?Number(raw):NaN;
      return {clock,consumed};
    };
    const check=()=>{
      if(settled)return;
      const current=state(),at=releasedAt();
      if(performance.now()>=deadline){finish(false);return;}
      if(pulseReturned&&fresh&&typeof release?.releasedEventAt==='number'&&Number.isFinite(release.releasedEventAt)&&release.releasedEventAt>=0&&at===release.releasedEventAt&&Number.isFinite(current.consumed)&&current.consumed>=at&&current.clock.pendingInputChanges===0&&predicate())finish(true);
    };
    const input=(event:KeyboardEvent)=>{
      if(settled||!event.isTrusted||event.repeat||!codes.includes(event.code)||!Number.isFinite(event.timeStamp)||event.timeStamp<0)return;
      if(event.type==='keyup'&&!pressed.has(event.code))return;
      try{
        fresh=false;observer?.takeRecords();
        if(event.type==='keydown'){pressed.add(event.code);released.delete(event.code);}else released.set(event.code,event.timeStamp);
      }catch(error){finish(false,error);}
    };
    const sample=()=>{
      frame=undefined;
      try{check();if(!settled)frame=requestAnimationFrame(sample);}catch(error){finish(false,error);}
    };
    try{
      observer=new MutationObserver(records=>{
        if(settled||!records.some(record=>record.attributeName==='data-simulation-clock'))return;
        try{
          const at=releasedAt();fresh=false;
          if(at!==undefined){const current=state();fresh=Number.isFinite(current.consumed)&&current.consumed>=at&&current.clock.pendingInputChanges===0&&predicate();}
          check();
        }catch(error){finish(false,error);}
      });
      observer.observe(world,{attributes:true,attributeFilter:['data-simulation-clock']});
      listeningDown=true;addEventListener('keydown',input,true);listeningUp=true;addEventListener('keyup',input,true);
      timer=setTimeout(()=>finish(false),deadline-performance.now());frame=requestAnimationFrame(sample);
    }catch(error){finish(false,error);}
    let pulseError:unknown,pulseRejected=false;
    if(!settled){
      try{
        release=await probe.pulse({codes,durationMs:200,deadlineEpochMs:performance.timeOrigin+deadline}) as {releasedEventAt?:number}|undefined;
        pulseReturned=true;check();
      }catch(error){pulseRejected=true;pulseError=error;finish(false,error);}
    }
    const result=await observation;
    if(result.error!==undefined)throw result.error;
    if(pulseRejected)throw pulseError;
    return result.value;
  };
  probe.start({kind:'coarse-materialize-unload',legTimeoutMs:2500,pulseMs:200});
  try{
    const entered=await leg('KeyD',()=>materialized()>0);
    const exited=entered&&await leg('KeyA',()=>materialized()===0);
    if(exited)await (window as unknown as {notifyCoarseTransitionExited:()=>Promise<void>}).notifyCoarseTransitionExited();
    return {before,entered,exited,materialized:materialized(),startedAt,finishedAt:performance.now()};
  }finally{await probe.finish();}
}
