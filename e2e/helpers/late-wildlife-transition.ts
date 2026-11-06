import type {driveNativeWaypoint} from './native-waypoint.js';

/** Serialized into the page after the waypoint driver is installed. */
export async function driveLateWildlifeTransition({wildlifeId}:{wildlifeId:string}) {
  const root=window as unknown as {
    lateWildlifeWaypoint:typeof driveNativeWaypoint;
    releaseLateWildlife:()=>Promise<void>;
  };
  const world=document.querySelector<HTMLElement>('#worldStatus');
  if(!world||typeof root.lateWildlifeWaypoint!=='function'||typeof root.releaseLateWildlife!=='function')
    throw new Error('Late wildlife transition requires its waypoint driver, release binding and diagnostics');
  const requestCreated=await new Promise<number>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);removeEventListener('latticefolk-e2e-wildlife-created',created);};
    const created=(event:Event)=>{
      try{
        const body=JSON.parse((event as CustomEvent<string>).detail) as {requests:Array<{wildlife:{id:string}}>};
        if(!body.requests.some(item=>item.wildlife.id===wildlifeId))return;
        cleanup();resolve(performance.now());
      }catch(error){cleanup();reject(error);}
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('Late wildlife request was not created'));},20_000);
    addEventListener('latticefolk-e2e-wildlife-created',created);
    window.dispatchEvent(new CustomEvent('latticefolk-e2e-wildlife-arm',{detail:wildlifeId}));
  });
  const outbound=await root.lateWildlifeWaypoint({target:{x:35.2,z:1.2},timeoutMs:8000,tolerance:.2,maxInputSeconds:2});
  if(!outbound.reached||!(outbound.x<35.7))throw new Error('Late wildlife outbound crossing was not reached');
  const unloaded=Number(world.dataset.materializedChunks);
  if(unloaded!==0)throw new Error('Late wildlife source was not unloaded');
  const inbound=await root.lateWildlifeWaypoint({target:{x:36.2,z:1.2},timeoutMs:8000,tolerance:.2,maxInputSeconds:2});
  if(!inbound.reached||!(inbound.x>35.8))throw new Error('Late wildlife return crossing was not reached');
  const materialized=Number(world.dataset.materializedChunks);
  if(materialized!==1)throw new Error('Late wildlife source was not rematerialized');
  const visible=(JSON.parse(world.dataset.wildlifeVisuals||'[]') as Array<{id:string}>).some(animal=>animal.id===wildlifeId);
  if(!visible)throw new Error('Late wildlife visual was not rematerialized');
  const releasedAt=performance.now();
  await root.releaseLateWildlife();
  return {requestCreated,outbound,unloaded,inbound,materialized,visible,releasedAt};
}
