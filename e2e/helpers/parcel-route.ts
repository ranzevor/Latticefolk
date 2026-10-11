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
  let yaw=0,held=false,detours=0,unchanged=0;
  let phase:'cross'|'offset'|'bypass'|'restore'='cross';
  let bypassX=0;
  const read=()=>{
    const d=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
    const p={x:Number(d?.playerX??'NaN'),z:Number(d?.playerZ??'NaN')};
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z))throw new Error('Parcel route position is unavailable');
    return p;
  };
  const pending=()=>{
    const clock=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.simulationClock??'null') as {pendingSeconds:number}|null;
    if(!clock||!Number.isFinite(clock.pendingSeconds)||clock.pendingSeconds<0)throw new Error('Parcel route clock observation is unavailable');
    return clock.pendingSeconds;
  };
  const nextFrame=()=>new Promise<void>((resolve,reject)=>{
    let frame:number|undefined,settled=false;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);resolve();};
    const timer=setTimeout(finish,Math.max(0,deadline-performance.now()));
    try{frame=requestAnimationFrame(finish);}catch(error){clearTimeout(timer);reject(error);}
  });
  const rotate=(next:number)=>{
    const event=new MouseEvent('mousemove',{bubbles:true});
    Object.defineProperties(event,{movementX:{value:(next-yaw)/.002},movementY:{value:0}});
    canvas.dispatchEvent(event);yaw=next;
  };
  const release=()=>{
    if(held)window.dispatchEvent(new KeyboardEvent('keyup',{code:key,bubbles:true}));
    held=false;
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
  try {
    while(performance.now()<deadline){
      if(document.pointerLockElement!==canvas)throw new Error('Parcel route lost pointer lock');
      if(pending()>0){await nextFrame();continue;}
      const p=read();
      unchanged=Math.hypot(p.x-previous.x,p.z-previous.z)<.0001?unchanged+1:0;
      previous=p;
      if(phase==='offset'&&Math.abs(p.z-(laneZ-.9))<.005){phase='bypass';unchanged=0;record(p);}
      if(phase==='bypass'&&direction*(p.x-bypassX)>=-.0001){phase='restore';unchanged=0;record(p);}
      if(phase==='restore'&&Math.abs(p.z-laneZ)<.005){phase='cross';unchanged=0;record(p);}
      if(phase==='cross'&&direction*(p.x-targetX)>=-.0001&&Math.abs(p.z-laneZ)<.005){
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
      window.dispatchEvent(new KeyboardEvent('keydown',{code:key,bubbles:true}));held=true;
      await new Promise<void>(resolve=>setTimeout(()=>{release();resolve();},pulseMs));
      await nextFrame();
    }
    throw failure('Parcel route exceeded its bounded input budget',read());
  } finally {
    // Release in the same page turn, rather than overshooting during a CDP reply.
    release();rotate(0);
  }
}

