/** Uses only the same keyboard and PointerLockControls mouse listeners as a player.
 * Keep this function self-contained: Playwright serializes it into the page.
 */
export async function traverseNativeParcelRoute({key,targetX,laneZ}: {
  key:'KeyA'|'KeyD';targetX:number;laneZ:number;
}) {
  const canvas=document.querySelector('#game canvas');
  if(!canvas||document.pointerLockElement!==canvas)throw new Error('Parcel route requires the locked game canvas');
  const direction=key==='KeyA'?-1:1;
  const deadline=performance.now()+90_000;
  let yaw=0,detours=0,unchanged=0;
  const probe=(window as unknown as {nativeInputProbe?:{
    start:(route:unknown)=>void;
    pulse:(request:{codes:string[];durationMs:number;deadlineEpochMs:number})=>Promise<{result?:{skipped?:boolean};releasedEventAt?:number}>;
    finish:()=>Promise<void>;
  }}).nativeInputProbe;
  if(!probe)throw new Error('Parcel route requires native input probe');
  let phase:'cross'|'offset'|'bypass'|'restore'='cross';
  let bypassX=0;
  const read=()=>{
    const d=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
    const p={x:Number(d?.playerX??'NaN'),z:Number(d?.playerZ??'NaN')};
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z))throw new Error('Parcel route position is unavailable');
    return p;
  };
  const pending=()=>{
    const clock=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.simulationClock??'null') as {pendingSeconds:number;pendingInputChanges:number}|null;
    if(!clock||!Number.isFinite(clock.pendingSeconds)||clock.pendingSeconds<0||!Number.isInteger(clock.pendingInputChanges)||clock.pendingInputChanges<0)throw new Error('Parcel route clock observation is unavailable');
    return clock;
  };
  const nextFrame=()=>new Promise<void>((resolve,reject)=>{
    let frame:number|undefined,settled=false;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);resolve();};
    const timer=setTimeout(finish,Math.max(0,deadline-performance.now()));
    try{frame=requestAnimationFrame(finish);}catch(error){clearTimeout(timer);reject(error);}
  });
  const observeRelease=()=>{
    const world=document.querySelector<HTMLElement>('#worldStatus');
    if(!world)throw new Error('Parcel route clock observation is unavailable');
    let pressed=false,releasedAt:number|undefined,fresh=false,settled=false,pulseReturned=false;
    let observer:MutationObserver|undefined,frame:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    let listeningDown=false,listeningUp=false,release:{result?:{skipped?:boolean};releasedEventAt?:number}|undefined;
    let complete!:(result:{consumed:boolean;error?:unknown})=>void;
    const observation=new Promise<{consumed:boolean;error?:unknown}>(resolve=>{complete=resolve;});
    const finish=(consumed:boolean,error?:unknown)=>{
      if(settled)return;settled=true;observer?.disconnect();
      if(listeningDown)removeEventListener('keydown',input,true);if(listeningUp)removeEventListener('keyup',input,true);
      if(frame!==undefined)cancelAnimationFrame(frame);if(timer!==undefined)clearTimeout(timer);
      complete({consumed,error});
    };
    const state=()=>{
      const clock=pending(),raw=world.dataset.simulationConsumedThrough,consumed=raw?.trim()?Number(raw):NaN;
      if(!Number.isFinite(consumed)||consumed<0)throw new Error('Parcel route consumed boundary is unavailable');
      return {clock,consumed};
    };
    const consumedRelease=()=>{
      const current=state();
      return releasedAt!==undefined&&current.consumed>=releasedAt&&current.clock.pendingSeconds===0&&current.clock.pendingInputChanges===0;
    };
    const check=()=>{
      if(settled)return;
      if(performance.now()>=deadline){finish(false);return;}
      if(pulseReturned&&fresh&&release?.releasedEventAt===releasedAt&&consumedRelease())finish(true);
    };
    const input=(event:KeyboardEvent)=>{
      if(settled||!event.isTrusted||event.repeat||event.code!==key||!Number.isFinite(event.timeStamp)||event.timeStamp<0)return;
      if(event.type==='keyup'&&!pressed)return;
      try{
        fresh=false;observer?.takeRecords();
        if(event.type==='keydown'){pressed=true;releasedAt=undefined;}else releasedAt=event.timeStamp;
      }catch(error){finish(false,error);}
    };
    const sample=()=>{
      frame=undefined;
      try{check();if(!settled)frame=requestAnimationFrame(sample);}catch(error){finish(false,error);}
    };
    try{
      observer=new MutationObserver(records=>{
        if(settled||!records.some(record=>record.attributeName==='data-simulation-clock'))return;
        try{fresh=consumedRelease();check();}catch(error){finish(false,error);}
      });
      observer.observe(world,{attributes:true,attributeFilter:['data-simulation-clock']});
      listeningDown=true;addEventListener('keydown',input,true);listeningUp=true;addEventListener('keyup',input,true);
      timer=setTimeout(()=>finish(false),Math.max(0,deadline-performance.now()));frame=requestAnimationFrame(sample);
    }catch(error){finish(false,error);}
    return {run:async(durationMs:number)=>{
      let pulseRejected=false,pulseError:unknown;
      if(!settled){
        try{
          release=await probe.pulse({codes:[key],durationMs,deadlineEpochMs:performance.timeOrigin+deadline});
          pulseReturned=true;
          if(release.result?.skipped)finish(false);
          else if(typeof release.releasedEventAt!=='number'||!Number.isFinite(release.releasedEventAt)||release.releasedEventAt<0)finish(false,new Error('Parcel route requires a trusted release boundary'));
          else check();
        }catch(error){pulseRejected=true;pulseError=error;finish(false,error);}
      }
      const result=await observation;
      if(result.error!==undefined)throw result.error;
      if(pulseRejected)throw pulseError;
      return result.consumed&&performance.now()<deadline;
    }};
  };
  const rotate=(next:number)=>{
    const event=new MouseEvent('mousemove',{bubbles:true});
    Object.defineProperties(event,{movementX:{value:(next-yaw)/.002},movementY:{value:0}});
    canvas.dispatchEvent(event);yaw=next;
  };
  const history:Array<{phase:string;x:number;z:number;elapsedMs:number}>=[];
  const record=(p:{x:number;z:number})=>{
    history.push({phase,...p,elapsedMs:performance.now()-(deadline-90_000)});
    if(history.length>20)history.shift();
  };
  const failure=(reason:string,p:{x:number;z:number})=>{
    const animals=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.wildlifeVisuals??'[]') as
      Array<{id:string;position:{x:number;z:number}}>;
    const nearbyWildlife=animals.filter(a=>Math.hypot(a.position.x-p.x,a.position.z-p.z)<3)
      .map(a=>({id:a.id,position:a.position}));
    const data=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
    return new Error(`${reason}: ${JSON.stringify({phase,position:p,nearbyWildlife,history,inputSeconds:Number(data?.playerInputSeconds),clock:JSON.parse(data?.simulationClock??'null')})}`);
  };
  let previous=read();record(previous);
  let failed=false;
  try {
    probe.start({key,targetX,laneZ,deadline});
    while(performance.now()<deadline){
      if(document.pointerLockElement!==canvas)throw new Error('Parcel route lost pointer lock');
      const clock=pending();
      if(clock.pendingSeconds>0||clock.pendingInputChanges>0){await nextFrame();continue;}
      const p=read();
      unchanged=Math.hypot(p.x-previous.x,p.z-previous.z)<.0001?unchanged+1:0;
      previous=p;
      if(phase==='offset'&&Math.abs(p.z-(laneZ-.9))<.005){phase='bypass';unchanged=0;record(p);}
      if(phase==='bypass'&&direction*(p.x-bypassX)>=-.0001){phase='restore';unchanged=0;record(p);}
      if(phase==='restore'&&Math.abs(p.z-laneZ)<.005){phase='cross';unchanged=0;record(p);}
      if(phase==='cross'&&direction*(p.x-targetX)>=-.0001&&Math.abs(p.x-targetX)<.005&&Math.abs(p.z-laneZ)<.005){
        record(p);return {position:p,detours,history};
      }
      if(unchanged>=4){
        // These are consecutive rendered-position samples, not repeated reads of
        // the 15-second persistence snapshot. Never wait through a pinned body.
        if(phase!=='cross'||detours!==0)throw failure('Parcel route remains blocked',p);
        detours++;bypassX=p.x+direction*1.8;phase='offset';unchanged=0;record(p);
      }
      const goal=phase==='offset'?{x:p.x,z:laneZ-.9}:phase==='restore'?{x:p.x,z:laneZ}
        :{x:phase==='bypass'?bypassX:targetX,z:phase==='bypass'?laneZ-.9:laneZ};
      const dx=goal.x-p.x,dz=goal.z-p.z;
      rotate(Math.atan2(direction*dz,direction*dx));
      const pulseMs=Math.min(250,Math.hypot(dx,dz)/4.5*1000,deadline-performance.now());
      if(!(pulseMs>0))break;
      if(!(await observeRelease().run(pulseMs)))break;
    }
    throw failure('Parcel route exceeded its bounded input budget',read());
  } catch(error){failed=true;throw error;}
  finally {
    let cleanupError:unknown,cleanupFailed=false;
    try{rotate(0);}catch(error){cleanupFailed=true;cleanupError=error;}
    try{await probe.finish();}catch(error){if(!cleanupFailed){cleanupFailed=true;cleanupError=error;}}
    if(!failed&&cleanupFailed)throw cleanupError;
  }
}


