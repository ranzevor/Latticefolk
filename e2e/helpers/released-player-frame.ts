export function observeReleasedPlayerFrame(timeoutMs=20_000):Promise<{x:number;z:number;inputSeconds:number;frameAt:number}> {
  return new Promise((resolve,reject)=>{
    const world=document.querySelector<HTMLElement>('#worldStatus');
    if(!world){reject(new Error('Player diagnostics are unavailable'));return;}
    const requestedAt=performance.now(),deadline=requestedAt+timeoutMs;
    let refreshed=false,settled=false,listeningDown=false,listeningUp=false;
    let observer:MutationObserver|undefined,frame:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{
      observer?.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);if(timer!==undefined)clearTimeout(timer);
      if(listeningDown)removeEventListener('keydown',input,true);if(listeningUp)removeEventListener('keyup',input,true);
    };
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const input=(event:KeyboardEvent)=>{
      if(!['KeyW','KeyA','KeyS','KeyD','ShiftLeft'].includes(event.code))return;
      try{observer?.takeRecords();refreshed=false;}catch(error){fail(error);}
    };
    const clock=()=>{
      const value=JSON.parse(world.dataset.simulationClock??'null') as {pendingSeconds:number;pendingInputChanges:number}|null;
      if(!value||!Number.isFinite(value.pendingSeconds)||value.pendingSeconds<0||!Number.isInteger(value.pendingInputChanges)||value.pendingInputChanges<0)throw new Error('Released input clock observation is unavailable');
      return value;
    };
    const sample=(frameAt:number)=>{
      frame=undefined;if(settled)return;
      try{
        const data=world.dataset,current=clock();
        const x=Number(data.playerX),z=Number(data.playerZ),inputSeconds=Number(data.playerInputSeconds);
        if(performance.now()>=deadline){fail(new Error('Released input has no fresh settled simulation frame'));return;}
        if(refreshed&&frameAt>=requestedAt&&current.pendingSeconds===0&&current.pendingInputChanges===0&&[x,z,inputSeconds].every(Number.isFinite)){
          settled=true;cleanup();resolve({x,z,inputSeconds,frameAt});return;
        }
        refreshed=false;frame=requestAnimationFrame(sample);
      }catch(error){fail(error);}
    };
    try{
      observer=new MutationObserver(records=>{
        if(settled||!records.some(record=>record.attributeName==='data-simulation-clock'))return;
        try{clock();refreshed=true;}catch(error){fail(error);}
      });
      observer.observe(world,{attributes:true,attributeFilter:['data-simulation-clock']});
      listeningDown=true;addEventListener('keydown',input,true);listeningUp=true;addEventListener('keyup',input,true);
      timer=setTimeout(()=>fail(new Error('Released input has no fresh settled simulation frame')),Math.max(0,deadline-performance.now()));
      frame=requestAnimationFrame(sample);
    }catch(error){fail(error);}
  });
}
