export function observeReleasedPlayerFrame(timeoutMs=20_000):Promise<{x:number;z:number;inputSeconds:number;frameAt:number}> {
  return new Promise((resolve,reject)=>{
    const world=document.querySelector<HTMLElement>('#worldStatus');
    if(!world){reject(new Error('Player diagnostics are unavailable'));return;}
    const requestedAt=performance.now();let refreshed=false,frame=0;
    const observer=new MutationObserver(()=>{refreshed=true;});
    observer.observe(world,{attributes:true,attributeFilter:['data-simulation-clock']});
    const cleanup=()=>{observer.disconnect();cancelAnimationFrame(frame);clearTimeout(timer);};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Released input has no fresh settled simulation frame'));},timeoutMs);
    const sample=(frameAt:number)=>{
      const data=world.dataset,clock=JSON.parse(data.simulationClock??'null');
      const x=Number(data.playerX),z=Number(data.playerZ),inputSeconds=Number(data.playerInputSeconds);
      if(refreshed&&frameAt>=requestedAt&&clock?.pendingSeconds===0&&[x,z,inputSeconds].every(Number.isFinite)){
        cleanup();resolve({x,z,inputSeconds,frameAt});return;
      }
      refreshed=false;frame=requestAnimationFrame(sample);
    };
    frame=requestAnimationFrame(sample);
  });
}
