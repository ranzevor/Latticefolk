/** Self-contained because Playwright serializes this function into Chromium.
 * Only ordinary keyboard listeners are driven; positions and calibrated NPC head
 * envelopes are read from the existing diagnostic DOM, never written. */
export async function driveNativeWaypoint({target,timeoutMs,tolerance,maxInputSeconds}: {
  target:{x:number;z:number};timeoutMs:number;tolerance:number;maxInputSeconds?:number;
}) {
  if(maxInputSeconds!==undefined&&(!Number.isFinite(maxInputSeconds)||maxInputSeconds<=0||!Number.isFinite(timeoutMs)||timeoutMs<=0))
    throw new Error('Waypoint input and wall budgets must be positive and finite');
  type Point={x:number;z:number};
  type Bounds={minX:number;maxX:number;minZ:number;maxZ:number};
  const canvas=document.querySelector('#game canvas');
  if(!canvas||document.pointerLockElement!==canvas)throw new Error('Waypoint requires the locked game canvas');
  const probe=(window as unknown as {nativeInputProbe?:{
    start:(route:unknown)=>void;pulse:(request:{codes:string[];durationMs:number;deadlineEpochMs:number})=>Promise<unknown>;finish:()=>Promise<void>
  }}).nativeInputProbe;
  const read=()=>{
    const data=document.querySelector<HTMLElement>('#worldStatus')?.dataset;
    return {x:Number(data?.playerX??'NaN'),z:Number(data?.playerZ??'NaN')};
  };
  const simulation=()=>{
    const value=document.querySelector<HTMLElement>('#worldStatus')?.dataset.playerInputSeconds;
    return value?.trim()?Number(value):NaN;
  };
  type Actor={position:Point;headYaw:number;headEnvelope:Bounds};
  const actors=()=>JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.characterSoles??'[]') as Actor[];
  const headClearance=(p:Point,a:Actor)=>{
    const e=a.headEnvelope,c=Math.cos(a.headYaw),s=Math.sin(a.headYaw);
    const dx=p.x-a.position.x,dz=p.z-a.position.z;
    const x=c*dx-s*dz,z=s*dx+c*dz;
    const qx=Math.abs(x-(e.minX+e.maxX)/2)-(e.maxX-e.minX)/2;
    const qz=Math.abs(z-(e.minZ+e.maxZ)/2)-(e.maxZ-e.minZ)/2;
    return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-.30;
  };
  const bodyClearance=(p:Point,a:Actor)=>Math.hypot(p.x-a.position.x,p.z-a.position.z)-.62;
  const clearance=(p:Point,a:Actor)=>Math.min(bodyClearance(p,a),headClearance(p,a));
  const route=(start:Point):Point[]=>{
    const obstacles=actors();
    const trees=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.treePresentation??'[]') as Array<{collider:Bounds}>;
    const staticClearance=(p:Point,b:Bounds)=>Math.hypot(
      Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ))-.30;
    const constraints=[...obstacles.flatMap(a=>[
      {clear:(p:Point)=>bodyClearance(p,a),recoverOverlap:true},
      {clear:(p:Point)=>headClearance(p,a),recoverOverlap:true}
    ]),...trees.map(t=>({clear:(p:Point)=>staticClearance(p,t.collider),recoverOverlap:false}))];
    if(!obstacles.some(a=>Math.hypot(a.position.x-start.x,a.position.z-start.z)<3)&&
      !trees.some(t=>staticClearance(start,t.collider)<3))return [];
    // Plan only input waypoints around observed collision envelopes. No world state is written.
    const step=.5,padding=3;
    const minX=Math.floor(Math.min(0,target.x-start.x)/step)-padding/step;
    const maxX=Math.ceil(Math.max(0,target.x-start.x)/step)+padding/step;
    const minZ=Math.floor(Math.min(0,target.z-start.z)/step)-padding/step;
    const maxZ=Math.ceil(Math.max(0,target.z-start.z)/step)+padding/step;
    const point=(x:number,z:number)=>({x:start.x+x*step,z:start.z+z*step});
    const edgeClear=(from:Point,to:Point,margin=.16)=>constraints.every(({clear,recoverOverlap})=>{
      const initial=clear(from);let previous=initial;
      if(!Number.isFinite(initial))return false;
      for(let t=.1;t<=1.001;t+=.1){
        const d=clear({x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t});
        // Escape a close starting edge, then keep a small walking margin.
        if(!Number.isFinite(d))return false;
        if(recoverOverlap&&previous<0){if(d<=previous+1e-9)return false;}
        else if(d<Math.min(Math.max(initial,0),margin)-1e-8||d<0)return false;
        previous=d;
      }
      return true;
    });
    type Node={x:number;z:number;g:number;f:number;parent?:Node};
    const first:Node={x:0,z:0,g:0,f:0},open=[first],best=new Map<string,number>([['0,0',0]]);
    let visited=0;
    while(open.length&&visited++<6000){
      open.sort((a,b)=>a.f-b.f);const n=open.shift()!;const p=point(n.x,n.z);
      const distance=Math.hypot(p.x-target.x,p.z-target.z);
      // The caller accepts a circle, not only its center or a lattice node.
      // A live NPC may cover the center while leaving valid points inside that
      // same original tolerance. Check a near-boundary approach point as well.
      const radius=Math.max(0,tolerance-Math.min(.01,tolerance*.02));
      const approach=distance>0?{x:target.x+(p.x-target.x)*radius/distance,z:target.z+(p.z-target.z)*radius/distance}:target;
      const endpoint=distance<=step+tolerance?[target,{x:target.x,z:p.z},{x:p.x,z:target.z},approach].find(goal=>{
        if(Math.hypot(goal.x-target.x,goal.z-target.z)>tolerance)return false;
        const corner={x:goal.x,z:p.z};
        return edgeClear(p,goal,0)&&edgeClear(p,corner,0)&&edgeClear(corner,goal,0);
      }):undefined;
      const terminal=endpoint!==undefined,corner={x:(endpoint??target).x,z:p.z};
      if(Math.hypot(p.x-target.x,p.z-target.z)<=tolerance||terminal){
        const nodes:Point[]=[];let current:Node|undefined=n;
        while(current?.parent){nodes.push(point(current.x,current.z));current=current.parent;}
        nodes.reverse();
        // Connect a checked point in the original goal region, so the lattice
        // cannot discard a reachable narrow-tolerance goal.
        if(endpoint)nodes.push(corner,endpoint);
        // Preserve turns but coalesce consecutive collinear cells.
        return nodes.filter((v,i)=>i===nodes.length-1||i===0||
          (v.x-nodes[i-1].x)!==(nodes[i+1].x-v.x)||(v.z-nodes[i-1].z)!==(nodes[i+1].z-v.z));
      }
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const x=n.x+dx,z=n.z+dz,key=`${x},${z}`,g=n.g+step*Math.hypot(dx,dz);
        if(x<minX||x>maxX||z<minZ||z>maxZ||(best.get(key)??Infinity)<=g)continue;
        const q=point(x,z);if(!edgeClear(p,q))continue;
        if(dx&&dz){
          // Native diagonal input is resolved one axis at a time by physics.
          // Require both cardinal corner paths as well as the diagonal itself.
          const xFirst={x:q.x,z:p.z},zFirst={x:p.x,z:q.z};
          if(!edgeClear(p,xFirst)||!edgeClear(xFirst,q)||!edgeClear(p,zFirst)||!edgeClear(zFirst,q))continue;
        }
        best.set(key,g);open.push({x,z,g,f:g+Math.hypot(target.x-q.x,target.z-q.z),parent:n});
      }
    }
    return [];
  };
  const held=new Set<string>();
  const setHeld=(next:Set<string>)=>{
    for(const code of [...held])if(!next.has(code)){
      window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));held.delete(code);
    }
    for(const code of next)if(!held.has(code)){
      window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));held.add(code);
    }
  };
  const begin=performance.now(),deadline=begin+timeoutMs;
  const probeDistance=.36;
  let lastInput=new Set<string>();
  let last=read(),unchanged=0,detours=0;
  let observedPosition={...last};
  let simulatedAt=simulation();
  if(!Number.isFinite(simulatedAt)||simulatedAt<0)throw new Error('Waypoint simulation observation is unavailable');
  const simulationBegin=simulatedAt;
  let stopReason='wall-budget';
  const budgetEvidence=(reason:string)=>({
    inputSeconds:simulatedAt-simulationBegin,elapsedMs:performance.now()-begin,stopReason:reason,
    clock:JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.simulationClock??'null')
  });
  // A collision still consumes accepted direction-input time. The wall timer
  // also releases input when RAF stops, provided the page event loop can run.
  const nextFrame=()=>new Promise<void>((resolve,reject)=>{
      let settled=false;
      let frame:number|undefined;
      const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);resolve();};
      const timer=setTimeout(finish,Math.max(0,deadline-performance.now()));
      try{frame=requestAnimationFrame(finish);}catch(error){settled=true;clearTimeout(timer);reject(error);}
    });
  let progress:{goal:Point;distance:number;requested:number;speed:number;arrival:number}|undefined;
  let waypoints:Point[]=[];
  let plannerBlocked=false,avoidSign=1;
  let fallback:{origin:Point;code:string}|undefined;
  // Preserve the old generic perpendicular escape for unknown static props.
  // Its normal-speed 850ms reach is now measured in world distance, so a slow
  // software-rendered frame cannot consume the entire escape without movement.
  const fallbackDistance=4.5*.85;
  const beginFallback=(p:Point)=>{
    avoidSign*=-1;
    const code=Math.abs(target.x-p.x)>=Math.abs(target.z-p.z)
      ?(avoidSign>0?'KeyW':'KeyS'):(avoidSign>0?'KeyD':'KeyA');
    fallback={origin:p,code};waypoints=[];unchanged=0;
  };
  const history:Array<{phase:string;x:number;z:number;elapsedMs:number}>=[];
  const record=(p:Point,phase:string)=>{
    history.push({phase,...p,elapsedMs:performance.now()-begin});
    if(history.length>24)history.shift();
  };
  const axisKey=(axis:'x'|'z',delta:number)=>axis==='x'?(delta>0?'KeyD':'KeyA'):(delta>0?'KeyS':'KeyW');
  try {
    probe?.start({target,timeoutMs,tolerance,maxInputSeconds,begin,deadline});
    while(true){
      if(document.pointerLockElement!==canvas)throw new Error('Waypoint lost pointer lock');
      const p=read();
      if(!Number.isFinite(p.x)||!Number.isFinite(p.z))throw new Error('Waypoint position is unavailable');
      const simulatedNow=simulation();
      if(!Number.isFinite(simulatedNow)||simulatedNow<simulatedAt)throw new Error('Waypoint simulation observation reset or became unavailable');
      const stepSeconds=simulatedNow-simulatedAt;
      simulatedAt=simulatedNow;
      const inputSeconds=simulatedNow-simulationBegin;
      if(stepSeconds===0&&Math.hypot(p.x-observedPosition.x,p.z-observedPosition.z)>1e-6)
        throw new Error('Waypoint position changed without observed direction input');
      if(performance.now()>deadline)break;
      if(maxInputSeconds!==undefined&&inputSeconds>maxInputSeconds+1e-9){stopReason='input-budget';break;}
      observedPosition=p;
      const pending=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.simulationClock??'null') as {pendingSeconds:number}|null;
      if(!pending||!Number.isFinite(pending.pendingSeconds)||pending.pendingSeconds<0)throw new Error('Waypoint clock observation is unavailable');
      if(pending.pendingSeconds>0){
        if(performance.now()>=deadline)break;
        await nextFrame();continue;
      }
      const distance=Math.hypot(target.x-p.x,target.z-p.z);
      if(distance<=tolerance){record(p,'reached');return {reached:true,...p,distance,detours,history,...budgetEvidence('reached')};}
      if(performance.now()>=deadline)break;
      if(maxInputSeconds!==undefined&&inputSeconds>=maxInputSeconds-1e-9){stopReason='input-budget';break;}
      if(stepSeconds>0){
        const movedThreshold=Math.min(.035,(progress?.speed??0)*stepSeconds*.2);
        if(Math.hypot(p.x-last.x,p.z-last.z)>movedThreshold){last=p;unchanged=0;}else unchanged++;
      }
      let slowProgress=false;
      if(progress){
        progress.requested+=progress.speed*stepSeconds;
        const remaining=Math.hypot(progress.goal.x-p.x,progress.goal.z-p.z);
        // Partial collision can move the player enough to reset `unchanged`
        // without useful progress. Compare against a bounded amount of issued
        // input, not wall time or a count of initially empty samples.
        // A fully stationary sequence keeps the existing four-sample recovery.
        // This extra check handles movement that would otherwise clear it.
        if(progress.requested>=1&&unchanged===0){
          slowProgress=remaining>progress.arrival&&progress.distance-remaining<progress.requested*.2;
          progress=undefined;
        }
      }
      if(unchanged>=4||slowProgress){
        if(slowProgress)record(p,'slow-progress');
        if(waypoints.length&&unchanged>=4){
          const x=Number(lastInput.has('KeyD'))-Number(lastInput.has('KeyA'));
          const z=Number(lastInput.has('KeyS'))-Number(lastInput.has('KeyW'));
          const next={x:p.x+x*probeDistance,z:p.z+z*probeDistance};
          // A stalled planned edge clear of observed NPCs is an unmodeled prop.
          // Do not repeat the same NPC-only plan into it; retain generic recovery.
          if(actors().every(a=>clearance(next,a)>=0))plannerBlocked=true;
        }
        waypoints=!plannerBlocked&&detours<3?route(p):[];
        unchanged=0;detours++;record(p,`route:${waypoints.length}`);
        if(!waypoints.length)beginFallback(p);else fallback=undefined;
        progress=undefined;
      }
      if(fallback&&Math.hypot(p.x-fallback.origin.x,p.z-fallback.origin.z)>=fallbackDistance){
        fallback=undefined;unchanged=0;record(p,'fallback-complete');
      }
      // Retain short corners that still require an axis input. A radial .19 m
      // shortcut can discard both approach points while outside the goal circle.
      while(waypoints.length&&Math.max(Math.abs(waypoints[0].x-p.x),Math.abs(waypoints[0].z-p.z))<=.12){
        waypoints.shift();record(p,'waypoint');
      }
      const aim=waypoints[0]??target,dx=aim.x-p.x,dz=aim.z-p.z;
      const next=new Set<string>();
      if(fallback){
        next.add(fallback.code);
      }else if(waypoints.length){
        if(Math.hypot(dx,dz)>probeDistance)next.add('ShiftLeft');
        if(Math.abs(dx)>.12)next.add(axisKey('x',dx));
        if(Math.abs(dz)>.12)next.add(axisKey('z',dz));
      }else{
        if(distance>1.8)next.add('ShiftLeft');
        if(Math.abs(dx)>tolerance*.6)next.add(axisKey('x',dx));
        if(Math.abs(dz)>tolerance*.6)next.add(axisKey('z',dz));
      }
      if(maxInputSeconds!==undefined&&performance.now()>=deadline)break;
      const goal=fallback?{
        x:fallback.origin.x+(fallback.code==='KeyD'?fallbackDistance:fallback.code==='KeyA'?-fallbackDistance:0),
        z:fallback.origin.z+(fallback.code==='KeyS'?fallbackDistance:fallback.code==='KeyW'?-fallbackDistance:0)
      }:aim;
      const arrival=(fallback||waypoints.length)? .19:tolerance;
      if(!progress||progress.goal.x!==goal.x||progress.goal.z!==goal.z||progress.arrival!==arrival){
        progress={goal:{...goal},distance:Math.hypot(goal.x-p.x,goal.z-p.z),requested:0,speed:0,arrival};
      }
      progress.speed=[...next].some(code=>code!=='ShiftLeft')?(next.has('ShiftLeft')?7.2:4.5):0;
      const axes=Number(next.has('KeyD')||next.has('KeyA'))+Number(next.has('KeyS')||next.has('KeyW'));
      const axisDistance=Math.min(
        next.has('KeyD')||next.has('KeyA')?Math.abs(goal.x-p.x):Infinity,
        next.has('KeyS')||next.has('KeyW')?Math.abs(goal.z-p.z):Infinity
      );
      const pulseMs=Math.min(250,axisDistance*Math.sqrt(axes)/progress.speed*1000,
        deadline-performance.now(),(maxInputSeconds===undefined?Infinity:maxInputSeconds-inputSeconds)*1000);
      if(!(pulseMs>0)||!Number.isFinite(pulseMs))throw new Error('Waypoint cannot issue a finite direction pulse');
      lastInput=next;
      if(probe)await probe.pulse({codes:[...next],durationMs:pulseMs,deadlineEpochMs:performance.timeOrigin+deadline});
      else {
        setHeld(next);
        await new Promise<void>(resolve=>setTimeout(()=>{setHeld(new Set());resolve();},pulseMs));
      }
      do {
        await nextFrame();
        const clock=JSON.parse(document.querySelector<HTMLElement>('#worldStatus')?.dataset.simulationClock??'null') as {pendingSeconds:number}|null;
        if(!clock||!Number.isFinite(clock.pendingSeconds)||clock.pendingSeconds<0)throw new Error('Waypoint clock observation is unavailable');
        if(clock.pendingSeconds===0)break;
      } while(performance.now()<deadline);
    }
    const finalSimulation=simulation();
    if(!Number.isFinite(finalSimulation)||finalSimulation<simulatedAt)throw new Error('Waypoint simulation observation reset or became unavailable');
    simulatedAt=finalSimulation;
    const p=read(),distance=Math.hypot(target.x-p.x,target.z-p.z);record(p,'deadline');
    return {reached:false,...p,distance,detours,history,...budgetEvidence(stopReason)};
  }finally {setHeld(new Set());await probe?.finish();}
}

